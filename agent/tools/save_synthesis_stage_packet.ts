import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  INTENT_BUCKET,
  PACKET_SCHEMA_VERSION,
  PROMPT_BUNDLE_VERSION,
  TAXONOMY_VERSION,
} from "../../contracts/enums";
import {
  computeIntentIdempotencyKey,
  ingestionIntentSchema,
  initialSummaryContentSchema,
  technologyFamilySchema,
  type IngestionIntent,
} from "../../contracts/ingestion-intent";
import { automaticReviewReasons } from "../../contracts/review-policy";
import {
  mergeDuplicateOrganizationSources,
  normalizeOrganizationSourceRanks,
} from "../../contracts/organization-invariants";
import {
  initialSummarySchema,
  organizationProfileContentSchema,
  organizationProfileSchema,
  technologyLibrarySummarySchema,
  validatePreResearchPacketCrossFile,
  type InitialSummary,
  type OrganizationProfile,
  type PreResearchPacket,
  type TechnologyLibrarySummary,
  type ResearchPhasePacket,
} from "../../contracts/pre-research-packet";
import {
  commitArtifact,
  downloadVerifiedArtifact,
  listRegisteredArtifacts,
  loadRegisteredResearchPacket,
  packetManifestHash,
  RESEARCH_PHASE_KINDS,
  SYNTHESIS_PHASE_KINDS,
} from "../lib/artifact-registry";
import {
  artifactRelativePath,
  packetStoragePrefix,
  SYNTHESIS_ARTIFACT_FILES,
} from "../lib/artifact-storage";
import { query } from "../lib/postgres";
import { normalizeApplicationDomainAssignments } from "../../lib/application-domain";
import { stableUuid } from "../../lib/stable-uuid";
import {
  assertRunMatchesPacket,
  assertSynthesisPhaseAccess,
  loadPreResearchRun,
} from "../lib/run-access";
import {
  synthesisStageFromMessages,
  type SynthesisStageName,
} from "../lib/turn-capabilities";

export const synthesisStageSchemas = {
  initial_summary: initialSummarySchema,
  technology_library_summary: technologyLibrarySummarySchema,
  organization_profile: organizationProfileSchema,
  ingestion_intent: ingestionIntentSchema,
} as const;

export const initialSummaryStageInputSchema = initialSummaryContentSchema.extend({ run_id: z.uuid() });

// GLM can serialize a top-level JSON null tool argument as the literal string
// "null" when the generated provider schema contains a nullable anyOf. Accept
// only that exact sentinel at the model-facing boundary, then normalize it
// before the strict immutable packet schema runs.
export function acceptModelNullString<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal("null")]).transform((value) => (
    value === "null" ? null : value
  ));
}

// The same provider occasionally serializes a complete top-level object tool
// argument as a JSON string. Keep this compatibility at the model-facing tool
// boundary: the decoded value must still pass the original strict schema, so
// arbitrary strings and malformed/invalid JSON cannot enter packet storage.
export function acceptModelJsonObjectString<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.string()]).transform((value, context) => {
    if (typeof value !== "string") return value;
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Expected a valid JSON object or null sentinel",
      });
      return z.NEVER;
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: `Decoded JSON tool argument failed validation: ${z.prettifyError(parsed.error)}`,
      });
      return z.NEVER;
    }
    return parsed.data;
  });
}

export const technologyStageInputSchema = z
  .object({
    run_id: z.uuid(),
    families: z.array(technologyFamilySchema).max(4),
    no_main_technology_reason: acceptModelNullString(z.string().min(1).nullable()),
  })
  .refine((value) => value.families.length > 0 || value.no_main_technology_reason !== null, {
    message: "no_main_technology_reason is required when families is empty",
  });

export const organizationStageInputSchema = organizationProfileContentSchema.extend({
  run_id: z.uuid(),
  primary_featured_organization: acceptModelJsonObjectString(
    organizationProfileContentSchema.shape.primary_featured_organization,
  ),
  parent_organization: acceptModelJsonObjectString(
    organizationProfileContentSchema.shape.parent_organization,
  ),
  speaker_employer: acceptModelJsonObjectString(
    organizationProfileContentSchema.shape.speaker_employer,
  ),
  featured_implementation: acceptModelJsonObjectString(
    organizationProfileContentSchema.shape.featured_implementation,
  ),
  no_organization_reason: acceptModelNullString(
    organizationProfileContentSchema.shape.no_organization_reason,
  ),
});

type EffectiveOrganizationProfileFields = Pick<
  OrganizationProfile,
  | "primary_featured_organization"
  | "other_organizations"
  | "primary_domain_code"
  | "secondary_domain_codes"
  | "no_organization_reason"
  | "review_reasons"
  | "unresolved_conflicts"
>;

const providerFrameworkLimitationPattern = /\bframework (?:serialization )?limitation\b/i;

/**
 * Recover the narrow legacy shape produced before stringified top-level object
 * arguments were decoded. Only a unique candidate that already declares both
 * primary status and rank one can be promoted. Genuine organization-less or
 * ambiguous profiles remain unchanged and therefore remain review-blocked.
 */
export function effectiveOrganizationProfile<T extends EffectiveOrganizationProfileFields>(
  profile: T,
): T {
  if (profile.primary_featured_organization) return profile;
  const promotable = profile.other_organizations.filter(
    (candidate) => candidate.is_primary_featured && candidate.featured_rank === 1,
  );
  if (promotable.length !== 1) return profile;
  const primary = promotable[0];
  return {
    ...profile,
    primary_featured_organization: primary,
    other_organizations: profile.other_organizations.filter(
      (candidate) => candidate.organization_candidate_id !== primary.organization_candidate_id,
    ),
    primary_domain_code: primary.primary_domain_code,
    secondary_domain_codes: primary.secondary_domain_codes,
    no_organization_reason: null,
    review_reasons: profile.review_reasons.filter(
      (reason) => !providerFrameworkLimitationPattern.test(reason),
    ),
    unresolved_conflicts: profile.unresolved_conflicts.filter(
      (conflict) => !providerFrameworkLimitationPattern.test(conflict),
    ),
  };
}

export const ingestionStageInputSchema = z.object({ run_id: z.uuid() });

const stageOrder: readonly SynthesisStageName[] = [
  "initial_summary",
  "technology_library_summary",
  "organization_profile",
  "ingestion_intent",
];

export type SynthesisArtifacts = {
  initial_summary: InitialSummary;
  technology_library_summary: TechnologyLibrarySummary;
  organization_profile: OrganizationProfile;
  ingestion_intent: IngestionIntent;
};

function normalizedUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function stampOrganizationIds(runId: string, raw: Record<string, unknown>): Record<string, unknown> {
  const primary = raw.primary_featured_organization as Record<string, unknown> | null | undefined;
  const others = Array.isArray(raw.other_organizations)
    ? (raw.other_organizations as Record<string, unknown>[])
    : [];
  const candidates = primary ? [primary, ...others] : others;
  const idMap = new Map<string, string>();
  const stampedCandidates = candidates.map((candidate) => {
    const oldId = String(candidate.organization_candidate_id ?? "");
    const identity = String(candidate.normalized_name ?? candidate.canonical_name ?? oldId)
      .trim()
      .toLowerCase();
    const newId = stableUuid(`pre-research:${runId}:organization:${identity}`);
    if (oldId) idMap.set(oldId, newId);
    return { ...candidate, organization_candidate_id: newId };
  });
  const stampedSources = Array.isArray(raw.sources)
    ? (raw.sources as Record<string, unknown>[]).flatMap((source) => {
        const oldCandidateId = String(source.organization_candidate_id ?? "");
        const candidateId = idMap.get(oldCandidateId);
        // A source cannot be persisted without a candidate parent. Model-
        // authored placeholder IDs that do not name any profile candidate are
        // unusable evidence rows; omit them before the immutable artifact is
        // validated and committed.
        if (!candidateId) return [];
        const sourceIdentity = String(source.normalized_url ?? source.url ?? source.organization_source_id ?? "")
          .trim()
          .toLowerCase();
        const canonicalUrl = normalizedUrl(String(source.url ?? source.normalized_url ?? ""));
        return [{
          ...source,
          organization_candidate_id: candidateId,
          normalized_url: canonicalUrl,
          organization_source_id: stableUuid(
            `pre-research:${runId}:organization-source:${candidateId}:${canonicalUrl || sourceIdentity}`,
          ),
        }];
      })
    : raw.sources;
  return {
    ...raw,
    primary_featured_organization: primary ? stampedCandidates[0] : null,
    other_organizations: primary ? stampedCandidates.slice(1) : stampedCandidates,
    sources: Array.isArray(stampedSources)
      ? mergeDuplicateOrganizationSources(stampedSources as never[])
      : stampedSources,
  };
}

function referencedEvidenceIds(value: unknown, target = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) referencedEvidenceIds(item, target);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.evidence_ids)) {
      for (const id of record.evidence_ids) if (typeof id === "string") target.add(id);
    }
    if (typeof record.evidence_id === "string") target.add(record.evidence_id);
    for (const nested of Object.values(record)) referencedEvidenceIds(nested, target);
  }
  return target;
}

export function buildIngestionIntent(
  run: Awaited<ReturnType<typeof loadPreResearchRun>>,
  research: ResearchPhasePacket,
  prior: Pick<SynthesisArtifacts, "initial_summary" | "technology_library_summary" | "organization_profile">,
): IngestionIntent {
  const transcript = research.transcript_analysis;
  const taxonomy = research.taxonomy_classification;
  const curriculum = research.curriculum_signals;
  const profile = effectiveOrganizationProfile(prior.organization_profile);
  const now = research.run_manifest.claimed_at;
  const anchors: Array<Record<string, unknown>> = transcript.evidence_anchors.map((anchor) => ({
    evidence_id: anchor.evidence_id,
    source_kind: anchor.source_kind,
    source_url: null,
    transcript_segment: anchor.short_excerpt,
    start_seconds: null,
    end_seconds: null,
    start_character: anchor.start_character,
    end_character: anchor.end_character,
    short_excerpt: anchor.short_excerpt,
    supports: anchor.supports,
  }));
  const knownAnchorIds = new Set(anchors.map((anchor) => anchor.evidence_id as string));
  const referenced = referencedEvidenceIds([prior, research.organization_research]);
  const sourceByEvidenceId = new Map(
    profile.sources
      .filter((source) => source.evidence_id)
      .map((source) => [source.evidence_id as string, source] as const),
  );
  const fallbackUrl =
    profile.sources[0]?.url ??
    research.source_verification.verified_results[0]?.url ??
    research.web_context.verified_results[0]?.url ??
    null;
  for (const evidenceId of referenced) {
    if (knownAnchorIds.has(evidenceId)) continue;
    const source = sourceByEvidenceId.get(evidenceId);
    anchors.push({
      evidence_id: evidenceId,
      source_kind: "web",
      source_url: source?.url ?? fallbackUrl,
      transcript_segment: null,
      start_seconds: null,
      end_seconds: null,
      start_character: null,
      end_character: null,
      short_excerpt: (source?.title ?? "Externally verified source supporting a synthesized research finding").slice(0, 400),
      supports: source?.supports.join("; ") ?? "External context, technology, or organization finding",
    });
  }

  const verifiedResourceByUrl = new Map(
    research.source_verification.resources.map((item) => [normalizedUrl(item.url), item] as const),
  );
  const resources = research.web_context.resources.slice(0, 25).map((item) => {
    const verified = verifiedResourceByUrl.get(normalizedUrl(item.url));
    return {
      resource_type: item.resource_type,
      title: item.title,
      url: item.url,
      normalized_url: normalizedUrl(item.url),
      publisher: verified?.publisher ?? item.publisher,
      relationship_to_video: item.relationship_to_video,
      why_valuable: item.why_valuable,
      verification_status: verified?.verification_status ?? "uncertain",
      is_first_party: verified?.is_first_party ?? item.claimed_first_party,
      license: null,
      confidence: verified?.verification_status === "verified" ? 0.9 : 0.6,
      evidence_ids: [],
    };
  });
  const verifiedEntityByName = new Map(
    research.source_verification.entities.map((item) => [item.name.toLowerCase(), item] as const),
  );
  const entities = research.web_context.entities.slice(0, 25).map((item) => {
    const verified = verifiedEntityByName.get(item.name.toLowerCase());
    return {
      entity_kind: item.entity_kind,
      name: item.name,
      normalized_name: item.name.trim().toLowerCase(),
      canonical_url: verified?.canonical_url ?? item.canonical_url,
      organization_name: item.organization_name,
      relationship_to_video: item.relationship_to_video,
      confidence: verified?.verification_status === "verified" ? 0.9 : 0.6,
      verification_status: verified?.verification_status ?? "uncertain",
      evidence_ids: [],
    };
  });
  const selectedUrls = new Set(
    research.source_verification.verified_results
      .filter((item) => item.verification_status === "verified")
      .map((item) => normalizedUrl(item.url)),
  );
  const searchGroups = [
    ["web_context_scout", research.web_context.searches],
    ["organization_researcher", research.organization_research.searches],
  ] as const;
  const searches = searchGroups.flatMap(([subagent, rows]) =>
    rows.map((item) => ({
      subagent,
      query: item.query,
      provider: "exa" as const,
      searched_at: now,
      result_urls: item.result_urls,
      selected_urls: item.result_urls.filter((url) => selectedUrls.has(normalizedUrl(url))),
      search_purpose: item.purpose,
    })),
  ).slice(0, 40);

  const operations = [
    {
      kind: "create_video_analysis",
      payload: {
        initial_summary: transcript.initial_summary,
        structured_summary: transcript.structured_summary,
        contextualized_abstract: prior.initial_summary.transcript_summary.slice(0, 2000),
        why_it_matters: prior.initial_summary.why_concepts_matter_together.slice(0, 1200),
        key_takeaways: transcript.key_takeaways,
        concepts: transcript.concepts,
        prerequisites: transcript.prerequisites,
        learning_outcomes: transcript.learning_outcomes,
        limitations: transcript.limitations,
        quantitative_claims: transcript.quantitative_claims,
        demonstrations: transcript.demonstrations,
        curriculum_roles: curriculum.curriculum_roles,
        challenge_seeds: curriculum.challenge_seeds,
        difficulty: taxonomy.difficulty,
        content_form: taxonomy.content_form,
        evidence_level: taxonomy.evidence_level,
        overall_confidence: taxonomy.primary.confidence,
      },
    },
    {
      kind: "create_contextualized_initial_summary",
      payload: {
        transcript_summary: prior.initial_summary.transcript_summary,
        software_engineering_concepts: prior.initial_summary.software_engineering_concepts,
        ai_concepts: prior.initial_summary.ai_concepts,
        why_concepts_matter_together: prior.initial_summary.why_concepts_matter_together,
        external_context_notes: prior.initial_summary.external_context_notes,
        temporal_context: prior.initial_summary.temporal_context,
        transcript_web_disagreement_note: prior.initial_summary.transcript_web_disagreement_note,
        evidence_ids: prior.initial_summary.evidence_ids,
      },
    },
    {
      kind: "replace_technology_library_summaries",
      payload: {
        families: prior.technology_library_summary.families,
        no_main_technology_reason: prior.technology_library_summary.no_main_technology_reason,
      },
    },
    {
      kind: "replace_category_assignments",
      payload: [
        { ...taxonomy.primary, assignment_role: "primary", alternative_rank: null },
        ...taxonomy.secondary.map((item, index) => ({
          ...item,
          assignment_role: "secondary",
          alternative_rank: index + 1,
        })),
      ],
    },
    {
      kind: "replace_domain_assignments",
      payload: normalizeApplicationDomainAssignments(taxonomy.domains),
    },
    { kind: "replace_lifecycle_assignments", payload: taxonomy.lifecycle_stages },
    { kind: "replace_evidence_anchors", payload: anchors },
    {
      kind: "replace_organization_candidates",
      payload: profile.primary_featured_organization
        ? [profile.primary_featured_organization, ...profile.other_organizations]
        : [],
    },
    {
      kind: "replace_organization_sources",
      payload: normalizeOrganizationSourceRanks(
        mergeDuplicateOrganizationSources(profile.sources),
      ),
    },
    { kind: "upsert_resource_candidates", payload: resources },
    { kind: "upsert_entity_candidates", payload: entities },
    { kind: "record_web_search_events", payload: searches },
  ];
  return ingestionIntentSchema.parse({
    schema_version: ingestionIntentSchema.shape.schema_version.value,
    intent_id: run.run_id,
    idempotency_key: "0".repeat(64),
    source: {
      video_id: run.video_id,
      run_id: run.run_id,
      transcript_sha256: run.transcript_sha256,
      taxonomy_version: run.taxonomy_version,
      prompt_bundle_version: run.prompt_bundle_version,
      model_id: run.model_id,
      research_as_of: research.run_manifest.research_as_of,
      packet_schema_version: run.packet_schema_version ?? research.run_manifest.schema_version,
    },
    evidence_grades_used: [
      ...new Set([
        ...transcript.evidence_anchors.map((anchor) => anchor.grade),
        ...(referenced.size > 0 ? ["verified_external" as const] : []),
      ]),
    ],
    operations,
  });
}

function synthesisReviewReasons(packet: PreResearchPacket): string[] {
  return automaticReviewReasons({
    intent: packet.ingestion_intent,
    profile: effectiveOrganizationProfile(packet.organization_profile),
  });
}

export function synthesisArtifactIdentity(
  stage: SynthesisStageName,
  value: SynthesisArtifacts[SynthesisStageName],
): { run_id: string; video_id: string; transcript_sha256: string } {
  if (stage === "ingestion_intent") {
    const intent = value as IngestionIntent;
    return intent.source;
  }
  return value as InitialSummary | TechnologyLibrarySummary | OrganizationProfile;
}

export async function loadRegisteredSynthesisArtifacts(
  runId: string,
): Promise<Partial<SynthesisArtifacts>> {
  const registered = await listRegisteredArtifacts(runId);
  const result: Partial<SynthesisArtifacts> = {};
  for (const stage of stageOrder) {
    const row = registered.find((candidate) => candidate.artifact_kind === stage);
    if (!row) continue;
    result[stage] = synthesisStageSchemas[stage].parse(await downloadVerifiedArtifact(row)) as never;
  }
  return result;
}

export async function finalizeSynthesis(
  runId: string,
  sessionId: string | null,
  packet: PreResearchPacket,
  idempotencyKeyRewritten: boolean,
) {
  const intent = packet.ingestion_intent;
  const run = await loadPreResearchRun(runId);
  const prefix = packetStoragePrefix(run.video_id, run.run_id);
  const uploaded = await commitArtifact({
    runId: run.run_id,
    artifactKind: "ingestion_intent",
    schemaVersion: intent.schema_version,
    relativePath: artifactRelativePath(
      run.video_id,
      run.run_id,
      SYNTHESIS_ARTIFACT_FILES.ingestion_intent,
    ),
    value: intent,
  });

  const registered = await listRegisteredArtifacts(run.run_id);
  const present = new Set(registered.map((row) => row.artifact_kind));
  const missing = [...RESEARCH_PHASE_KINDS, ...SYNTHESIS_PHASE_KINDS].filter(
    (kind) => !present.has(kind),
  );
  if (missing.length > 0) {
    throw new Error(`PACKET_INCOMPLETE: missing registered artifacts ${missing.join(", ")}`);
  }

  const intentPath = uploaded.storage_path;
  const intentSha = uploaded.content_sha256;
  const intentRows = await query<{ intent_id: string; content_sha256: string; status: string }>(
    `insert into public.research_ingestion_intent (
       intent_id, run_id, video_id, schema_version, idempotency_key,
       storage_bucket, storage_path, content_sha256, status, validated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'validated', timezone('utc', now()))
     on conflict (run_id) do update
     set
       schema_version = excluded.schema_version,
       idempotency_key = excluded.idempotency_key,
       storage_bucket = excluded.storage_bucket,
       storage_path = excluded.storage_path,
       status = 'validated',
       validated_at = excluded.validated_at
     where public.research_ingestion_intent.content_sha256 = excluded.content_sha256
       and public.research_ingestion_intent.status in ('draft', 'validated')
     returning intent_id, content_sha256, status`,
    [
      intent.intent_id,
      run.run_id,
      run.video_id,
      intent.schema_version,
      intent.idempotency_key,
      INTENT_BUCKET,
      intentPath,
      intentSha,
    ],
  );
  const intentRow = intentRows[0];
  if (!intentRow) {
    throw new Error(
      "INTENT_CONTENT_COLLISION: research_ingestion_intent already exists for this run with different content",
    );
  }

  // The artifact FK points to research_ingestion_intent, so attach it only
  // after the parent ledger row exists. Other phase artifacts intentionally
  // register with a null intent_id as well.
  await query(
    `update public.research_pre_research_artifact
        set intent_id = $2
      where run_id = $1 and artifact_kind = 'ingestion_intent'`,
    [run.run_id, intentRow.intent_id],
  );

  const packetSha = packetManifestHash(prefix, registered);
  await query(
    `update public.research_pre_research_run
     set intent_path = $2, intent_sha256 = $3,
         packet_storage_prefix = $4, packet_sha256 = $5
     where run_id = $1`,
    [run.run_id, intentPath, intentSha, prefix, packetSha],
  );

  const reviewReasons = synthesisReviewReasons(packet);
  const nextStatus = reviewReasons.length > 0 ? "review_required" : "intent_ready";
  let phaseTransitionError: string | null = null;
  try {
    if (sessionId === null) {
      return {
        saved: true as const,
        phase: "synthesis" as const,
        stage: "ingestion_intent" as const,
        run_id: run.run_id,
        video_id: run.video_id,
        intent_id: intentRow.intent_id,
        next_status: nextStatus,
        review_reasons: reviewReasons,
        packet_storage_prefix: prefix,
        packet_sha256: packetSha,
        intent_path: intentPath,
        intent_sha256: intentSha,
        artifact: uploaded,
        idempotency_key: intent.idempotency_key,
        idempotency_key_rewritten: idempotencyKeyRewritten,
        phase_transition_error: null,
      };
    }
    await query(
      `select research_private.complete_synthesis_phase(
         $1::uuid, $2::text, $3::public.research_pre_research_run_status
       ) as result`,
      [run.run_id, sessionId, nextStatus],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    phaseTransitionError = `COMPLETE_SYNTHESIS_PHASE_FAILED: ${message}`;
  }

  return {
    saved: true as const,
    phase: "synthesis" as const,
    stage: "ingestion_intent" as const,
    run_id: run.run_id,
    video_id: run.video_id,
    intent_id: intentRow.intent_id,
    next_status: nextStatus,
    review_reasons: reviewReasons,
    packet_storage_prefix: prefix,
    packet_sha256: packetSha,
    intent_path: intentPath,
    intent_sha256: intentSha,
    artifact: uploaded,
    idempotency_key: intent.idempotency_key,
    idempotency_key_rewritten: idempotencyKeyRewritten,
    phase_transition_error: phaseTransitionError,
  };
}

export default defineDynamic({
  events: {
    "step.started": (_event, resolveCtx) => {
      const stage = synthesisStageFromMessages(resolveCtx.messages);
      if (!stage) return null;
      const inputSchema = (stage === "technology_library_summary"
        ? technologyStageInputSchema
        : stage === "organization_profile"
          ? organizationStageInputSchema
          : stage === "ingestion_intent"
            ? ingestionStageInputSchema
            : stage === "initial_summary"
              ? initialSummaryStageInputSchema
        : synthesisStageSchemas[stage]) as z.ZodTypeAny;
      return defineTool({
        description:
          stage === "ingestion_intent"
            ? "Synthesis final stage only. Validate and save 90 against registered 00-80, write the intent ledger, and complete synthesis."
            : `Synthesis stage ${stage} only. Validate and durably save this one artifact; do not prepare later stages.`,
        inputSchema,
        async execute(raw, ctx) {
          const parsed = inputSchema.parse(raw) as Record<string, unknown>;
          const rawRunId = parsed.run_id as string;
          const run = await loadPreResearchRun(rawRunId);
          assertSynthesisPhaseAccess(run, ctx.session.id);
          let value: SynthesisArtifacts[SynthesisStageName];
          if (stage === "initial_summary") {
            const { packet: research } = await loadRegisteredResearchPacket(run.run_id);
            value = initialSummarySchema.parse({
              ...parsed,
              schema_version: PACKET_SCHEMA_VERSION,
              video_id: run.video_id,
              transcript_sha256: run.transcript_sha256,
              research_as_of: research.run_manifest.research_as_of,
              video_published_at: research.run_manifest.video_published_at,
              generated_at: new Date().toISOString(),
            });
          } else if (stage === "technology_library_summary") {
            const { packet: research } = await loadRegisteredResearchPacket(run.run_id);
            value = technologyLibrarySummarySchema.parse({
              schema_version: PACKET_SCHEMA_VERSION,
              run_id: run.run_id,
              video_id: run.video_id,
              transcript_sha256: run.transcript_sha256,
              research_as_of: research.run_manifest.research_as_of,
              video_published_at: research.run_manifest.video_published_at,
              generated_at: new Date().toISOString(),
              families: parsed.families,
              no_main_technology_reason: parsed.no_main_technology_reason,
            });
          } else if (stage === "organization_profile") {
            const { packet: research } = await loadRegisteredResearchPacket(run.run_id);
            value = organizationProfileSchema.parse({
              ...stampOrganizationIds(run.run_id, parsed),
              schema_version: PACKET_SCHEMA_VERSION,
              video_id: run.video_id,
              transcript_sha256: run.transcript_sha256,
              research_as_of: research.run_manifest.research_as_of,
              video_published_at: research.run_manifest.video_published_at,
              generated_at: new Date().toISOString(),
            });
          } else {
            const { packet: research } = await loadRegisteredResearchPacket(run.run_id);
            const existing = await loadRegisteredSynthesisArtifacts(run.run_id);
            value = buildIngestionIntent(
              run,
              research,
              existing as Pick<
                SynthesisArtifacts,
                "initial_summary" | "technology_library_summary" | "organization_profile"
              >,
            );
          }
          const identity = synthesisArtifactIdentity(stage, value);
          assertRunMatchesPacket(run, identity);

          const stageIndex = stageOrder.indexOf(stage);
          const existing = await loadRegisteredSynthesisArtifacts(run.run_id);
          const missingPrior = stageOrder
            .slice(0, stageIndex)
            .filter((candidate) => !existing[candidate]);
          if (missingPrior.length > 0) {
            throw new Error(`SYNTHESIS_STAGE_ORDER: missing ${missingPrior.join(", ")}`);
          }

          if (stage !== "ingestion_intent") {
            const artifact = await commitArtifact({
              runId: run.run_id,
              artifactKind: stage,
              schemaVersion: value.schema_version,
              relativePath: artifactRelativePath(
                run.video_id,
                run.run_id,
                SYNTHESIS_ARTIFACT_FILES[stage],
              ),
              value,
            });
            return {
              saved: true as const,
              phase: "synthesis" as const,
              stage,
              run_id: run.run_id,
              video_id: run.video_id,
              artifact,
              next_stage: stageOrder[stageIndex + 1],
            };
          }

          const intent = value as IngestionIntent;
          intent.source.prompt_bundle_version = PROMPT_BUNDLE_VERSION;
          intent.source.taxonomy_version = TAXONOMY_VERSION;
          intent.source.model_id = "zai/glm-5.2";
          intent.source.packet_schema_version = PACKET_SCHEMA_VERSION;
          const expectedKey = computeIntentIdempotencyKey({
            schema_version: intent.schema_version,
            source: intent.source,
            evidence_grades_used: intent.evidence_grades_used,
            operations: intent.operations,
          });
          const idempotencyKeyRewritten = intent.idempotency_key !== expectedKey;
          intent.idempotency_key = expectedKey;

          const { packet: research } = await loadRegisteredResearchPacket(run.run_id);
          const prior = existing as Pick<
            SynthesisArtifacts,
            "initial_summary" | "technology_library_summary" | "organization_profile"
          >;
          const packet: PreResearchPacket = {
            ...research,
            ...prior,
            ingestion_intent: intent,
            evidence_grades_used: intent.evidence_grades_used,
          };
          const cross = validatePreResearchPacketCrossFile(packet);
          if (!cross.ok) throw new Error(`PACKET_CROSS_FILE: ${cross.errors.join("; ")}`);
          return finalizeSynthesis(run.run_id, ctx.session.id, packet, idempotencyKeyRewritten);
        },
      });
    },
  },
});
