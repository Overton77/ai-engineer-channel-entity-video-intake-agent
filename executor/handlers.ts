import type { PoolClient } from "pg";
import type {
  IntentOperation,
  IntentOperationV1,
  OrganizationCandidatePayload,
  OrganizationSourcePayload,
} from "../contracts/ingestion-intent";
import { clientQuery } from "./postgres";
import { tableForOperationKind } from "./operations";
import { normalizeOfficialUrl, normalizeUrl } from "./url-normalization";

export type HandlerContext = {
  client: PoolClient;
  runId: string;
  videoId: string;
  analysisId: string | null;
  researchAsOf: string | null;
  videoPublishedAt: Date | string | null;
};

export type HandlerResult = {
  affectedTable: string;
  affectedKey: string | null;
  analysisId?: string;
};

type AnyOperation = IntentOperation | IntentOperationV1;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function requireAnalysisId(ctx: HandlerContext, kind: string): string {
  if (!ctx.analysisId) {
    throw new Error(`${kind} requires create_video_analysis to run first`);
  }
  return ctx.analysisId;
}

function collectedEvidenceIds(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectedEvidenceIds(item, acc);
    }
    return acc;
  }
  if (!value || typeof value !== "object") {
    return acc;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.evidence_ids)) {
    for (const id of record.evidence_ids) {
      if (typeof id === "string") {
        acc.add(id);
      }
    }
  }
  if (typeof record.evidence_id === "string") {
    acc.add(record.evidence_id);
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key === "evidence_ids" || key === "evidence_id") {
      continue;
    }
    collectedEvidenceIds(nested, acc);
  }
  return acc;
}

export async function assertEvidenceIdsExist(
  client: PoolClient,
  analysisId: string,
  referenced: Iterable<string>,
): Promise<void> {
  const ids = [...new Set(referenced)];
  if (ids.length === 0) {
    return;
  }
  const rows = await clientQuery<{ evidence_id: string }>(
    client,
    `select evidence_id
       from public.research_evidence_anchor
      where analysis_id = $1
        and evidence_id = any($2::uuid[])`,
    [analysisId, ids],
  );
  const found = new Set(rows.map((row) => row.evidence_id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`Referenced evidence IDs are missing for this analysis: ${missing.join(", ")}`);
  }
}

async function createVideoAnalysis(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "create_video_analysis" }>["payload"],
): Promise<HandlerResult> {
  const rows = await clientQuery<{ analysis_id: string }>(
    ctx.client,
    `insert into public.research_video_analysis (
       run_id, video_id, initial_summary, structured_summary, contextualized_abstract,
       why_it_matters, key_takeaways, concepts, prerequisites, learning_outcomes,
       limitations, quantitative_claims, demonstrations, curriculum_roles,
       challenge_seeds, difficulty, content_form, evidence_level, overall_confidence
     ) values (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
       $11::jsonb, $12::jsonb, $13::jsonb, $14::text[], $15::jsonb,
       $16::public.research_difficulty, $17::public.research_content_form,
       $18::public.research_evidence_level, $19
     )
     returning analysis_id`,
    [
      ctx.runId,
      ctx.videoId,
      payload.initial_summary,
      payload.structured_summary,
      payload.contextualized_abstract,
      payload.why_it_matters,
      json(payload.key_takeaways),
      json(payload.concepts),
      json(payload.prerequisites),
      json(payload.learning_outcomes),
      json(payload.limitations),
      json(payload.quantitative_claims),
      json(payload.demonstrations),
      payload.curriculum_roles,
      json(payload.challenge_seeds),
      payload.difficulty,
      payload.content_form,
      payload.evidence_level,
      payload.overall_confidence,
    ],
  );
  const analysisId = rows[0]?.analysis_id;
  if (!analysisId) {
    throw new Error("create_video_analysis did not return analysis_id");
  }
  return {
    affectedTable: "research_video_analysis",
    affectedKey: analysisId,
    analysisId,
  };
}

async function createContextualizedInitialSummary(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "create_contextualized_initial_summary" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "create_contextualized_initial_summary");
  if (!ctx.researchAsOf) {
    throw new Error("create_contextualized_initial_summary requires research_as_of");
  }
  await clientQuery(
    ctx.client,
    `insert into public.research_video_initial_summary (
       analysis_id, video_id, transcript_summary, software_engineering_concepts,
       ai_concepts, external_context_notes, temporal_context, research_as_of, evidence_ids
     ) values (
       $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::date, $9::uuid[]
     )`,
    [
      analysisId,
      ctx.videoId,
      payload.transcript_summary,
      json(payload.software_engineering_concepts),
      json(payload.ai_concepts),
      json(payload.external_context_notes),
      payload.temporal_context,
      ctx.researchAsOf,
      payload.evidence_ids,
    ],
  );
  return { affectedTable: "research_video_initial_summary", affectedKey: analysisId };
}

async function replaceTechnologyLibrarySummaries(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "replace_technology_library_summaries" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "replace_technology_library_summaries");
  if (!ctx.researchAsOf) {
    throw new Error("replace_technology_library_summaries requires research_as_of");
  }
  await clientQuery(
    ctx.client,
    `delete from public.research_video_technology_summary where analysis_id = $1`,
    [analysisId],
  );
  for (const family of payload.families) {
    const officialUrls = family.official_urls.map((url) => normalizeOfficialUrl(url));
    const implementations = family.implementations.map((implementation) => ({
      ...implementation,
      official_url: implementation.official_url
        ? normalizeOfficialUrl(implementation.official_url)
        : null,
    }));
    await clientQuery(
      ctx.client,
      `insert into public.research_video_technology_summary (
         analysis_id, video_id, family_rank, family_label, primary_technology,
         primary_technology_kind, related_technologies, implementations, summary,
         relationship_rationale, role_in_video, current_status, temporal_status,
         video_published_at, research_as_of, official_urls, evidence_ids, confidence
       ) values (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13,
         $14, $15::date, $16::jsonb, $17::uuid[], $18
       )`,
      [
        analysisId,
        ctx.videoId,
        family.family_rank,
        family.family_label,
        family.primary_technology,
        family.primary_technology_kind,
        json(family.related_technologies),
        json(implementations),
        family.summary,
        family.relationship_rationale,
        family.role_in_video,
        family.current_status,
        family.temporal_status,
        ctx.videoPublishedAt,
        ctx.researchAsOf,
        json(officialUrls),
        family.evidence_ids,
        family.confidence,
      ],
    );
  }
  return {
    affectedTable: "research_video_technology_summary",
    affectedKey: `${analysisId}:${payload.families.length}`,
  };
}

async function replaceCategoryAssignments(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "replace_category_assignments" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "replace_category_assignments");
  await clientQuery(ctx.client, `delete from public.research_video_category where analysis_id = $1`, [
    analysisId,
  ]);
  for (const row of payload) {
    await clientQuery(
      ctx.client,
      `insert into public.research_video_category (
         analysis_id, category_code, assignment_role, confidence, rationale, alternative_rank
       ) values (
         $1, $2::public.research_engineering_category_code,
         $3::public.research_category_assignment_role, $4, $5, $6
       )`,
      [
        analysisId,
        row.category_code,
        row.assignment_role,
        row.confidence,
        row.rationale,
        row.alternative_rank,
      ],
    );
  }
  return { affectedTable: "research_video_category", affectedKey: analysisId };
}

async function replaceDomainAssignments(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "replace_domain_assignments" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "replace_domain_assignments");
  await clientQuery(ctx.client, `delete from public.research_video_domain where analysis_id = $1`, [
    analysisId,
  ]);
  for (const row of payload) {
    await clientQuery(
      ctx.client,
      `insert into public.research_video_domain (
         analysis_id, domain_code, confidence, rationale
       ) values ($1, $2, $3, $4)`,
      [analysisId, row.domain_code, row.confidence, row.rationale],
    );
  }
  return { affectedTable: "research_video_domain", affectedKey: analysisId };
}

async function replaceLifecycleAssignments(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "replace_lifecycle_assignments" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "replace_lifecycle_assignments");
  await clientQuery(ctx.client, `delete from public.research_video_lifecycle where analysis_id = $1`, [
    analysisId,
  ]);
  for (const stage of payload) {
    await clientQuery(
      ctx.client,
      `insert into public.research_video_lifecycle (analysis_id, lifecycle_stage)
       values ($1, $2::public.research_lifecycle_stage)`,
      [analysisId, stage],
    );
  }
  return { affectedTable: "research_video_lifecycle", affectedKey: analysisId };
}

async function replaceEvidenceAnchors(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "replace_evidence_anchors" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "replace_evidence_anchors");
  await clientQuery(ctx.client, `delete from public.research_evidence_anchor where analysis_id = $1`, [
    analysisId,
  ]);
  for (const anchor of payload) {
    await clientQuery(
      ctx.client,
      `insert into public.research_evidence_anchor (
         evidence_id, analysis_id, source_kind, source_url, transcript_segment,
         start_seconds, end_seconds, start_character, end_character, short_excerpt, supports
       ) values (
         $1, $2, $3::public.research_evidence_source_kind, $4, $5, $6, $7, $8, $9, $10, $11
       )`,
      [
        anchor.evidence_id,
        analysisId,
        anchor.source_kind,
        anchor.source_url,
        anchor.transcript_segment,
        anchor.start_seconds,
        anchor.end_seconds,
        anchor.start_character,
        anchor.end_character,
        anchor.short_excerpt,
        anchor.supports,
      ],
    );
  }
  return { affectedTable: "research_evidence_anchor", affectedKey: analysisId };
}

async function replaceOrganizationCandidates(
  ctx: HandlerContext,
  payload: OrganizationCandidatePayload[],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "replace_organization_candidates");
  await clientQuery(
    ctx.client,
    `delete from public.research_organization_candidate where analysis_id = $1`,
    [analysisId],
  );
  for (const candidate of payload) {
    await clientQuery(
      ctx.client,
      `insert into public.research_organization_candidate (
         organization_candidate_id, analysis_id, video_id, canonical_name, normalized_name,
         organization_scope, relationship_roles, is_primary_featured, featured_rank,
         primary_domain_code, secondary_domain_codes, parent_name, parent_canonical_url,
         official_url, authoritative_summary, relationship_to_implementation, current_status,
         status_as_of, video_time_name, video_time_parent_name, ownership_changed_since_video,
         confidence, evidence_ids
       ) values (
         $1, $2, $3, $4, $5,
         $6::public.research_organization_scope,
         $7::public.research_video_organization_role[],
         $8, $9,
         $10::public.research_organization_domain_code,
         $11::public.research_organization_domain_code[],
         $12, $13, $14, $15, $16, $17, $18::date, $19, $20, $21, $22, $23::uuid[]
       )`,
      [
        candidate.organization_candidate_id,
        analysisId,
        ctx.videoId,
        candidate.canonical_name,
        candidate.normalized_name,
        candidate.organization_scope,
        candidate.relationship_roles,
        candidate.is_primary_featured,
        candidate.featured_rank,
        candidate.primary_domain_code,
        candidate.secondary_domain_codes,
        candidate.parent_name,
        candidate.parent_canonical_url
          ? normalizeOfficialUrl(candidate.parent_canonical_url)
          : null,
        normalizeOfficialUrl(candidate.official_url),
        candidate.authoritative_summary,
        candidate.relationship_to_implementation,
        candidate.current_status,
        candidate.status_as_of,
        candidate.video_time_name,
        candidate.video_time_parent_name,
        candidate.ownership_changed_since_video,
        candidate.confidence,
        candidate.evidence_ids,
      ],
    );
  }
  return {
    affectedTable: "research_organization_candidate",
    affectedKey: `${analysisId}:${payload.length}`,
  };
}

async function replaceOrganizationSources(
  ctx: HandlerContext,
  payload: OrganizationSourcePayload[],
): Promise<HandlerResult> {
  requireAnalysisId(ctx, "replace_organization_sources");
  const candidateIds = [...new Set(payload.map((source) => source.organization_candidate_id))];
  if (candidateIds.length > 0) {
    await clientQuery(
      ctx.client,
      `delete from public.research_organization_source
        where organization_candidate_id = any($1::uuid[])`,
      [candidateIds],
    );
  }
  for (const source of payload) {
    const normalizedUrl = normalizeOfficialUrl(source.url);
    await clientQuery(
      ctx.client,
      `insert into public.research_organization_source (
         organization_source_id, organization_candidate_id, source_rank, source_role,
         authority_tier, title, publisher, url, normalized_url, publicly_retrievable,
         retrieved_at, source_published_at, supports, verification_status,
         is_required_core_source, evidence_id
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
         $14::public.research_verification_status, $15, $16
       )`,
      [
        source.organization_source_id,
        source.organization_candidate_id,
        source.source_rank,
        source.source_role,
        source.authority_tier,
        source.title,
        source.publisher,
        source.url,
        normalizedUrl,
        source.publicly_retrievable,
        source.retrieved_at,
        source.source_published_at,
        json(source.supports),
        source.verification_status,
        source.is_required_core_source,
        source.evidence_id,
      ],
    );
  }
  return {
    affectedTable: "research_organization_source",
    affectedKey: String(payload.length),
  };
}

async function upsertResourceCandidates(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "upsert_resource_candidates" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "upsert_resource_candidates");
  for (const resource of payload) {
    const normalizedUrl = normalizeOfficialUrl(resource.url);
    await clientQuery(
      ctx.client,
      `insert into public.research_resource_candidate (
         analysis_id, resource_type, title, url, normalized_url, publisher,
         relationship_to_video, why_valuable, verification_status, is_first_party,
         license, confidence, evidence_ids
       ) values (
         $1, $2::public.research_resource_type, $3, $4, $5, $6, $7, $8,
         $9::public.research_verification_status, $10, $11, $12, $13::uuid[]
       )
       on conflict (analysis_id, normalized_url) do update set
         resource_type = excluded.resource_type,
         title = excluded.title,
         url = excluded.url,
         publisher = excluded.publisher,
         relationship_to_video = excluded.relationship_to_video,
         why_valuable = excluded.why_valuable,
         verification_status = excluded.verification_status,
         is_first_party = excluded.is_first_party,
         license = excluded.license,
         confidence = excluded.confidence,
         evidence_ids = excluded.evidence_ids`,
      [
        analysisId,
        resource.resource_type,
        resource.title,
        resource.url,
        normalizedUrl,
        resource.publisher,
        resource.relationship_to_video,
        resource.why_valuable,
        resource.verification_status,
        resource.is_first_party,
        resource.license,
        resource.confidence,
        resource.evidence_ids,
      ],
    );
  }
  return { affectedTable: "research_resource_candidate", affectedKey: analysisId };
}

async function upsertEntityCandidates(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "upsert_entity_candidates" }>["payload"],
): Promise<HandlerResult> {
  const analysisId = requireAnalysisId(ctx, "upsert_entity_candidates");
  for (const entity of payload) {
    const canonicalUrl = entity.canonical_url ? normalizeUrl(entity.canonical_url) : null;
    await clientQuery(
      ctx.client,
      `insert into public.research_entity_candidate (
         analysis_id, entity_kind, name, normalized_name, canonical_url,
         organization_name, relationship_to_video, confidence, verification_status, evidence_ids
       ) values (
         $1, $2::public.research_entity_kind, $3, $4, $5, $6, $7, $8,
         $9::public.research_verification_status, $10::uuid[]
       )`,
      [
        analysisId,
        entity.entity_kind,
        entity.name,
        entity.normalized_name,
        canonicalUrl,
        entity.organization_name,
        entity.relationship_to_video,
        entity.confidence,
        entity.verification_status,
        entity.evidence_ids,
      ],
    );
  }
  return { affectedTable: "research_entity_candidate", affectedKey: analysisId };
}

async function recordWebSearchEvents(
  ctx: HandlerContext,
  payload: Extract<IntentOperation, { kind: "record_web_search_events" }>["payload"],
): Promise<HandlerResult> {
  for (const event of payload) {
    await clientQuery(
      ctx.client,
      `insert into public.research_web_search_event (
         run_id, subagent, query, provider, searched_at, result_urls, selected_urls, search_purpose
       ) values (
         $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
       )`,
      [
        ctx.runId,
        event.subagent,
        event.query,
        event.provider,
        event.searched_at,
        json(event.result_urls),
        json(event.selected_urls),
        event.search_purpose,
      ],
    );
  }
  return { affectedTable: "research_web_search_event", affectedKey: ctx.runId };
}

export async function applyOperation(
  ctx: HandlerContext,
  operation: AnyOperation,
): Promise<HandlerResult> {
  const table = tableForOperationKind(operation.kind);
  switch (operation.kind) {
    case "create_video_analysis":
      return createVideoAnalysis(ctx, operation.payload);
    case "create_contextualized_initial_summary":
      return createContextualizedInitialSummary(ctx, operation.payload);
    case "replace_technology_library_summaries":
      return replaceTechnologyLibrarySummaries(ctx, operation.payload);
    case "replace_category_assignments":
      return replaceCategoryAssignments(ctx, operation.payload);
    case "replace_domain_assignments":
      return replaceDomainAssignments(ctx, operation.payload);
    case "replace_lifecycle_assignments":
      return replaceLifecycleAssignments(ctx, operation.payload);
    case "replace_evidence_anchors":
      return replaceEvidenceAnchors(ctx, operation.payload);
    case "replace_organization_candidates":
      return replaceOrganizationCandidates(ctx, operation.payload);
    case "replace_organization_sources":
      return replaceOrganizationSources(ctx, operation.payload);
    case "upsert_resource_candidates":
      return upsertResourceCandidates(ctx, operation.payload);
    case "upsert_entity_candidates":
      return upsertEntityCandidates(ctx, operation.payload);
    case "record_web_search_events":
      return recordWebSearchEvents(ctx, operation.payload);
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unhandled operation for table ${table}: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function referencedEvidenceIds(operations: readonly AnyOperation[]): string[] {
  return [...collectedEvidenceIds(operations)];
}
