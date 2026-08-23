import { z } from "zod";
import {
  authorityTierSchema,
  confidenceSchema,
  contentFormSchema,
  difficultySchema,
  engineeringCategoryCodeSchema,
  entityKindSchema,
  evidenceGradeSchema,
  evidenceLevelSchema,
  lifecycleStageSchema,
  organizationSourceRoleSchema,
  PACKET_SCHEMA_VERSION,
  researchOrganizationDomainCodeSchema,
  resourceTypeSchema,
  sha256Schema,
  V1_PACKET_SCHEMA_VERSION,
  verificationStatusSchema,
} from "./enums";
import {
  featuredImplementationSchema,
  ingestionIntentSchema,
  ingestionIntentV1Schema,
  initialSummaryContentSchema,
  organizationCandidatePayloadSchema,
  organizationSourcePayloadSchema,
  parentOrganizationSchema,
  parseIngestionIntent,
  speakerEmployerSchema,
  technologyLibrarySummaryContentSchema,
  type IngestionIntent,
} from "./ingestion-intent";
import {
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
} from "./organization-invariants";

const packetIdentitySchema = z.object({
  run_id: z.uuid(),
  video_id: z.string().min(1),
  transcript_sha256: sha256Schema,
  research_as_of: z.iso.date(),
});

export const verifiedSourceResultSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  source_role: organizationSourceRoleSchema,
  authority_tier: authorityTierSchema,
  publicly_retrievable: z.boolean(),
  verification_status: verificationStatusSchema,
  checked_at: z.iso.datetime(),
  claim_supported: z.string().min(1),
  release_or_status_date: z.iso.date().nullable(),
});

export const runManifestV1Schema = z.object({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  video_id: z.string().min(1),
  taxonomy_version: z.string().min(1),
  prompt_bundle_version: z.string().min(1),
  model_id: z.literal("zai/glm-5.2"),
  transcript_sha256: sha256Schema,
  transcript_bucket: z.string().nullable(),
  transcript_path: z.string().nullable(),
  claimed_at: z.iso.datetime(),
});

export const runManifestSchema = z.object({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  video_id: z.string().min(1),
  taxonomy_version: z.string().min(1),
  prompt_bundle_version: z.string().min(1),
  model_id: z.literal("zai/glm-5.2"),
  transcript_sha256: sha256Schema,
  transcript_bucket: z.string().nullable(),
  transcript_path: z.string().nullable(),
  claimed_at: z.iso.datetime(),
  research_as_of: z.iso.date(),
  video_published_at: z.iso.datetime().nullable(),
});

export const transcriptAnalysisV1Schema = z.object({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  video_id: z.string().min(1),
  transcript_sha256: sha256Schema,
  initial_summary: z.string().min(200).max(1200),
  structured_summary: z.string().min(400).max(4000),
  key_takeaways: z.array(z.string().min(1)).min(5).max(10),
  concepts: z.array(z.string().min(1)).max(30),
  demonstrations: z.array(z.string().min(1)).max(20),
  quantitative_claims: z.array(z.string().min(1)).max(20),
  limitations: z.array(z.string().min(1)).max(20),
  prerequisites: z.array(z.string().min(1)).max(20),
  learning_outcomes: z.array(z.string().min(1)).max(20),
  sections: z.array(
    z.object({
      title: z.string().min(1),
      start_character: z.number().int().nullable(),
      end_character: z.number().int().nullable(),
      summary: z.string().min(1),
    }),
  ),
  evidence_anchors: z.array(
    z.object({
      evidence_id: z.uuid(),
      source_kind: z.literal("transcript"),
      start_character: z.number().int().nullable(),
      end_character: z.number().int().nullable(),
      short_excerpt: z.string().min(1).max(400),
      supports: z.string().min(1),
      grade: z.enum(["said_in_transcript", "inferred_from_transcript"]),
    }),
  ),
});

export const transcriptAnalysisSchema = transcriptAnalysisV1Schema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  research_as_of: z.iso.date(),
});

export const taxonomyClassificationV1Schema = z.object({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  taxonomy_version: z.string().min(1),
  primary: z.object({
    category_code: engineeringCategoryCodeSchema,
    confidence: confidenceSchema,
    rationale: z.string().min(1),
  }),
  secondary: z
    .array(
      z.object({
        category_code: engineeringCategoryCodeSchema,
        confidence: confidenceSchema,
        rationale: z.string().min(1),
      }),
    )
    .max(3),
  alternative: z
    .object({
      category_code: engineeringCategoryCodeSchema,
      confidence: confidenceSchema,
      rationale: z.string().min(1),
    })
    .nullable(),
  domains: z
    .array(
      z.object({
        domain_code: z.string().min(1),
        confidence: confidenceSchema,
        rationale: z.string().min(1),
      }),
    )
    .min(1)
    .max(6),
  lifecycle_stages: z.array(lifecycleStageSchema).min(1).max(7),
  difficulty: difficultySchema,
  content_form: contentFormSchema,
  evidence_level: evidenceLevelSchema,
});

export const taxonomyClassificationSchema = taxonomyClassificationV1Schema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  video_id: z.string().min(1),
  transcript_sha256: sha256Schema,
  research_as_of: z.iso.date(),
});

export const webContextV1Schema = z.object({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  searches: z.array(
    z.object({
      query: z.string().min(1),
      provider: z.literal("exa"),
      purpose: z.string().min(1),
      result_urls: z.array(z.url()),
    }),
  ),
  resources: z.array(
    z.object({
      resource_type: resourceTypeSchema,
      title: z.string().min(1),
      url: z.url(),
      publisher: z.string().nullable(),
      relationship_to_video: z.string().min(1),
      why_valuable: z.string().min(1),
      claimed_first_party: z.boolean(),
    }),
  ),
  entities: z.array(
    z.object({
      entity_kind: entityKindSchema,
      name: z.string().min(1),
      organization_name: z.string().nullable(),
      canonical_url: z.url().nullable(),
      relationship_to_video: z.string().min(1),
    }),
  ),
});

export const webContextSchema = webContextV1Schema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  searches: webContextV1Schema.shape.searches.max(3),
  video_id: z.string().min(1),
  transcript_sha256: sha256Schema,
  research_as_of: z.iso.date(),
  video_published_at: z.iso.datetime().nullable(),
  verified_results: z.array(verifiedSourceResultSchema),
});

export const sourceVerificationV1Schema = z.object({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  resources: z.array(
    z.object({
      url: z.url(),
      verification_status: verificationStatusSchema,
      is_first_party: z.boolean(),
      rationale: z.string().min(1),
    }),
  ),
  entities: z.array(
    z.object({
      name: z.string().min(1),
      verification_status: verificationStatusSchema,
      rationale: z.string().min(1),
    }),
  ),
});

export const sourceVerificationSchema = z.object({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  video_id: z.string().min(1),
  transcript_sha256: sha256Schema,
  research_as_of: z.iso.date(),
  resources: z.array(
    z.object({
      url: z.url(),
      title: z.string().min(1),
      publisher: z.string().min(1),
      source_role: organizationSourceRoleSchema,
      authority_tier: authorityTierSchema,
      publicly_retrievable: z.boolean(),
      verification_status: verificationStatusSchema,
      is_first_party: z.boolean(),
      rationale: z.string().min(1),
      checked_at: z.iso.datetime(),
      claim_supported: z.string().min(1),
      release_or_status_date: z.iso.date().nullable(),
    }),
  ),
  entities: z.array(
    z.object({
      name: z.string().min(1),
      verification_status: verificationStatusSchema,
      rationale: z.string().min(1),
      canonical_url: z.url().nullable(),
      source_role: organizationSourceRoleSchema.nullable(),
      authority_tier: authorityTierSchema.nullable(),
      publicly_retrievable: z.boolean().nullable(),
      checked_at: z.iso.datetime().nullable(),
      claim_supported: z.string().min(1).nullable(),
    }),
  ),
  verified_results: z.array(verifiedSourceResultSchema),
});

export const curriculumSignalsV1Schema = z.object({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
  run_id: z.uuid(),
  curriculum_roles: z.array(z.string().min(1)).max(10),
  suggested_lesson_placement: z.string().min(1),
  prerequisites: z.array(z.string().min(1)).max(20),
  learning_outcomes: z.array(z.string().min(1)).max(20),
  lab_potential: z.string().min(1),
  challenge_potential: z.string().min(1),
  challenge_seeds: z.array(z.string().min(1)).max(10),
  assessment_methods: z.array(z.string().min(1)).max(10),
  related_categories: z.array(engineeringCategoryCodeSchema).max(5),
  recommended_learner_level: difficultySchema,
});

export const curriculumSignalsSchema = curriculumSignalsV1Schema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  video_id: z.string().min(1),
  transcript_sha256: sha256Schema,
  research_as_of: z.iso.date(),
});

export const organizationResearchCandidateSchema = organizationCandidatePayloadSchema
  .omit({ organization_candidate_id: true })
  .extend({
    organization_candidate_id: z.uuid().optional(),
  });

export const organizationResearchProposedSourceSchema = z.object({
  source_rank: z.number().int().min(1),
  source_role: organizationSourceRoleSchema,
  authority_tier: authorityTierSchema.nullable(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  publicly_retrievable: z.boolean(),
  supports: z.array(z.string().min(1)),
});

export const organizationResearchSchema = packetIdentitySchema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  video_published_at: z.iso.datetime().nullable(),
  featured_implementation: featuredImplementationSchema.nullable(),
  candidates: z.array(organizationResearchCandidateSchema).max(20),
  speaker_employer: speakerEmployerSchema.nullable(),
  proposed_sources: z.array(organizationResearchProposedSourceSchema).max(12),
  searches: z.array(
    z.object({
      query: z.string().min(1),
      provider: z.literal("exa"),
      purpose: z.string().min(1),
      result_urls: z.array(z.url()),
    }),
  ).max(3),
  unresolved_conflicts: z.array(z.string().min(1)),
  review_required: z.boolean(),
  review_reasons: z.array(z.string().min(1)),
  no_organization_reason: z.string().min(1).nullable(),
});

export const initialSummarySchema = packetIdentitySchema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  video_published_at: z.iso.datetime().nullable(),
  generated_at: z.iso.datetime(),
  ...initialSummaryContentSchema.shape,
});

export const technologyLibrarySummarySchema = packetIdentitySchema
  .extend({
    schema_version: z.literal(PACKET_SCHEMA_VERSION),
    video_published_at: z.iso.datetime().nullable(),
    generated_at: z.iso.datetime(),
  })
  .and(technologyLibrarySummaryContentSchema);

export const organizationProfileContentSchema = z.object({
    primary_featured_organization: organizationCandidatePayloadSchema.nullable(),
    parent_organization: parentOrganizationSchema.nullable(),
    speaker_employer: speakerEmployerSchema.nullable(),
    other_organizations: z.array(organizationCandidatePayloadSchema).max(19),
    sources: z.array(organizationSourcePayloadSchema).max(40),
    featured_implementation: featuredImplementationSchema.nullable(),
    primary_domain_code: researchOrganizationDomainCodeSchema,
    secondary_domain_codes: z.array(researchOrganizationDomainCodeSchema).max(2),
    unresolved_conflicts: z.array(z.string().min(1)),
    review_required: z.boolean(),
    review_reasons: z.array(z.string().min(1)),
    searches_attempted: z.array(z.string().min(1)),
    no_organization_reason: z.string().min(1).nullable(),
  });

export const organizationProfileSchema = packetIdentitySchema
  .extend({
    schema_version: z.literal(PACKET_SCHEMA_VERSION),
    video_published_at: z.iso.datetime().nullable(),
    generated_at: z.iso.datetime(),
  })
  .and(organizationProfileContentSchema)
  .superRefine((profile, ctx) => {
    if (profile.primary_featured_organization === null) {
      if (profile.primary_domain_code !== "other_unknown") {
        ctx.addIssue({
          code: "custom",
          message: "Missing primary organization must use primary_domain_code other_unknown",
        });
      }
      if (!profile.no_organization_reason) {
        ctx.addIssue({
          code: "custom",
          message: "no_organization_reason is required when no organization is identified",
        });
      }
      if (!profile.review_required) {
        ctx.addIssue({
          code: "custom",
          message: "review_required must be true when no organization is identified",
        });
      }
      return;
    }

    const candidates = [
      profile.primary_featured_organization,
      ...profile.other_organizations,
    ];
    const candidateCheck = validateOrganizationCandidateSet(candidates);
    for (const message of candidateCheck.errors) {
      ctx.addIssue({ code: "custom", message });
    }

    if (profile.primary_domain_code !== profile.primary_featured_organization.primary_domain_code) {
      ctx.addIssue({
        code: "custom",
        message: "Profile primary_domain_code must match the primary featured organization",
      });
    }

    if (profile.primary_featured_organization.primary_domain_code === "other_unknown") {
      if (!profile.review_required) {
        ctx.addIssue({
          code: "custom",
          message: "other_unknown primary organization domain requires review_required",
        });
      }
      return;
    }

    const primarySources = profile.sources.filter(
      (source) =>
        source.organization_candidate_id ===
        profile.primary_featured_organization?.organization_candidate_id,
    );
    if (primarySources.length < 2 || primarySources.length > 6) {
      ctx.addIssue({
        code: "custom",
        message: "Primary organization must have two to six ranked sources",
      });
    }
    const sourceCheck = validateAuthoritativeSourceMinimum(primarySources);
    for (const message of sourceCheck.errors) {
      ctx.addIssue({ code: "custom", message });
    }
  });

export const preResearchPacketV1Schema = z.object({
  run_manifest: runManifestV1Schema,
  transcript_analysis: transcriptAnalysisV1Schema,
  taxonomy_classification: taxonomyClassificationV1Schema,
  web_context: webContextV1Schema,
  source_verification: sourceVerificationV1Schema,
  curriculum_signals: curriculumSignalsV1Schema,
  ingestion_intent: ingestionIntentV1Schema,
  evidence_grades_used: z.array(evidenceGradeSchema),
});

export const preResearchPacketSchema = z.object({
  run_manifest: runManifestSchema,
  transcript_analysis: transcriptAnalysisSchema,
  taxonomy_classification: taxonomyClassificationSchema,
  web_context: webContextSchema,
  organization_research: organizationResearchSchema,
  source_verification: sourceVerificationSchema,
  curriculum_signals: curriculumSignalsSchema,
  initial_summary: initialSummarySchema,
  technology_library_summary: technologyLibrarySummarySchema,
  organization_profile: organizationProfileSchema,
  ingestion_intent: ingestionIntentSchema,
  evidence_grades_used: z.array(evidenceGradeSchema),
});

export type RunManifest = z.infer<typeof runManifestSchema>;
export type RunManifestV1 = z.infer<typeof runManifestV1Schema>;
export type TranscriptAnalysis = z.infer<typeof transcriptAnalysisSchema>;
export type TaxonomyClassification = z.infer<typeof taxonomyClassificationSchema>;
export type WebContext = z.infer<typeof webContextSchema>;
export type SourceVerification = z.infer<typeof sourceVerificationSchema>;
export type CurriculumSignals = z.infer<typeof curriculumSignalsSchema>;
export type OrganizationResearch = z.infer<typeof organizationResearchSchema>;
export type InitialSummary = z.infer<typeof initialSummarySchema>;
export type TechnologyLibrarySummary = z.infer<typeof technologyLibrarySummarySchema>;
export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;
export type PreResearchPacketV1 = z.infer<typeof preResearchPacketV1Schema>;
export type PreResearchPacket = z.infer<typeof preResearchPacketSchema>;
export type ResearchPhasePacket = {
  run_manifest: RunManifest;
  transcript_analysis: TranscriptAnalysis;
  taxonomy_classification: TaxonomyClassification;
  web_context: WebContext;
  organization_research: OrganizationResearch;
  source_verification: SourceVerification;
  curriculum_signals: CurriculumSignals;
};
export type PacketCrossFileResult = {
  ok: boolean;
  errors: string[];
};

export function filterKnownEvidenceIds(
  evidenceIds: readonly string[],
  knownEvidenceIds: ReadonlySet<string>,
): string[] {
  return [...new Set(evidenceIds.filter((evidenceId) => knownEvidenceIds.has(evidenceId)))];
}

export function sameNullableInstant(
  left: string | null,
  right: string | null,
): boolean {
  if (left === null || right === null) return left === right;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

type IdentityFields = {
  run_id?: string;
  video_id?: string;
  transcript_sha256?: string;
  research_as_of?: string;
  video_published_at?: string | null;
};

function collectEvidenceIds(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEvidenceIds(item, acc);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
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
    collectEvidenceIds(nested, acc);
  }
}

function checkIdentity(
  errors: string[],
  label: string,
  actual: IdentityFields,
  expected: {
    run_id: string;
    video_id: string;
    transcript_sha256: string;
    research_as_of: string;
    video_published_at: string | null;
  },
): void {
  if (actual.run_id && actual.run_id !== expected.run_id) {
    errors.push(`${label}.run_id does not match run_manifest`);
  }
  if (actual.video_id && actual.video_id !== expected.video_id) {
    errors.push(`${label}.video_id does not match run_manifest`);
  }
  if (actual.transcript_sha256 && actual.transcript_sha256 !== expected.transcript_sha256) {
    errors.push(`${label}.transcript_sha256 does not match run_manifest`);
  }
  if (actual.research_as_of && actual.research_as_of !== expected.research_as_of) {
    errors.push(`${label}.research_as_of does not match run_manifest`);
  }
  if (
    actual.video_published_at !== undefined &&
    !sameNullableInstant(actual.video_published_at, expected.video_published_at)
  ) {
    errors.push(`${label}.video_published_at does not match run_manifest`);
  }
}

export type PartialResearchPhasePacket = Pick<
  ResearchPhasePacket,
  "run_manifest" | "transcript_analysis"
> &
  Partial<Omit<ResearchPhasePacket, "run_manifest" | "transcript_analysis">>;

export function validatePartialResearchPhasePacketCrossFile(
  packet: PartialResearchPhasePacket,
): PacketCrossFileResult {
  const errors: string[] = [];
  const expected = {
    run_id: packet.run_manifest.run_id,
    video_id: packet.run_manifest.video_id,
    transcript_sha256: packet.run_manifest.transcript_sha256,
    research_as_of: packet.run_manifest.research_as_of,
    video_published_at: packet.run_manifest.video_published_at,
  };

  const artifacts: Array<[string, IdentityFields | undefined]> = [
    ["transcript_analysis", packet.transcript_analysis],
    ["taxonomy_classification", packet.taxonomy_classification],
    ["web_context", packet.web_context],
    ["organization_research", packet.organization_research],
    ["source_verification", packet.source_verification],
    ["curriculum_signals", packet.curriculum_signals],
  ];
  for (const [label, artifact] of artifacts) {
    if (!artifact) continue;
    checkIdentity(errors, label, artifact, expected);
  }

  const knownEvidenceIds = new Set<string>();
  for (const anchor of packet.transcript_analysis.evidence_anchors) {
    knownEvidenceIds.add(anchor.evidence_id);
  }
  const referenced = new Set<string>();
  if (packet.organization_research) {
    collectEvidenceIds(packet.organization_research, referenced);
  }
  for (const evidenceId of referenced) {
    if (!knownEvidenceIds.has(evidenceId)) {
      errors.push(`Referenced evidence_id ${evidenceId} is not present in transcript anchors`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateResearchPhasePacketCrossFile(
  packet: ResearchPhasePacket,
): PacketCrossFileResult {
  return validatePartialResearchPhasePacketCrossFile(packet);
}

export function validatePreResearchPacketCrossFile(packet: PreResearchPacket): PacketCrossFileResult {
  const errors: string[] = [];
  const expected = {
    run_id: packet.run_manifest.run_id,
    video_id: packet.run_manifest.video_id,
    transcript_sha256: packet.run_manifest.transcript_sha256,
    research_as_of: packet.run_manifest.research_as_of,
    video_published_at: packet.run_manifest.video_published_at,
  };

  const artifacts: Array<[string, IdentityFields]> = [
    ["transcript_analysis", packet.transcript_analysis],
    ["taxonomy_classification", packet.taxonomy_classification],
    ["web_context", packet.web_context],
    ["organization_research", packet.organization_research],
    ["source_verification", packet.source_verification],
    ["curriculum_signals", packet.curriculum_signals],
    ["initial_summary", packet.initial_summary],
    ["technology_library_summary", packet.technology_library_summary],
    ["organization_profile", packet.organization_profile],
  ];
  for (const [label, artifact] of artifacts) {
    checkIdentity(errors, label, artifact, expected);
  }

  let intent: IngestionIntent;
  try {
    intent = parseIngestionIntent(packet.ingestion_intent) as IngestionIntent;
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : "ingestion_intent failed schema_version dispatch",
    );
    return { ok: false, errors };
  }

  checkIdentity(errors, "ingestion_intent.source", intent.source, expected);
  if (intent.source.packet_schema_version !== PACKET_SCHEMA_VERSION) {
    errors.push("ingestion_intent.source.packet_schema_version must be 2.0.0");
  }

  const knownEvidenceIds = new Set<string>();
  for (const anchor of packet.transcript_analysis.evidence_anchors) {
    knownEvidenceIds.add(anchor.evidence_id);
  }
  const evidenceOp = intent.operations.find((operation) => operation.kind === "replace_evidence_anchors");
  if (evidenceOp && evidenceOp.kind === "replace_evidence_anchors") {
    for (const anchor of evidenceOp.payload) {
      knownEvidenceIds.add(anchor.evidence_id);
    }
  }

  const referenced = new Set<string>();
  collectEvidenceIds(packet.initial_summary, referenced);
  collectEvidenceIds(packet.technology_library_summary, referenced);
  collectEvidenceIds(packet.organization_profile, referenced);
  collectEvidenceIds(packet.organization_research, referenced);
  collectEvidenceIds(intent.operations, referenced);
  for (const evidenceId of referenced) {
    if (!knownEvidenceIds.has(evidenceId)) {
      errors.push(`Referenced evidence_id ${evidenceId} is not present in transcript or intent anchors`);
    }
  }

  const summaryOp = intent.operations.find(
    (operation) => operation.kind === "create_contextualized_initial_summary",
  );
  if (summaryOp && summaryOp.kind === "create_contextualized_initial_summary") {
    if (summaryOp.payload.transcript_summary !== packet.initial_summary.transcript_summary) {
      errors.push("create_contextualized_initial_summary must match 60-initial-summary.json");
    }
  }

  const technologyOp = intent.operations.find(
    (operation) => operation.kind === "replace_technology_library_summaries",
  );
  if (technologyOp && technologyOp.kind === "replace_technology_library_summaries") {
    if (technologyOp.payload.families.length !== packet.technology_library_summary.families.length) {
      errors.push("replace_technology_library_summaries must match 70-technology-library-summary.json");
    }
  }

  const candidatesOp = intent.operations.find(
    (operation) => operation.kind === "replace_organization_candidates",
  );
  const sourcesOp = intent.operations.find(
    (operation) => operation.kind === "replace_organization_sources",
  );
  const profile = packet.organization_profile;
  if (profile.primary_featured_organization) {
    const profileCandidates = [profile.primary_featured_organization, ...profile.other_organizations];
    const candidateCheck = validateOrganizationCandidateSet(profileCandidates);
    errors.push(...candidateCheck.errors);

    if (profile.primary_featured_organization.primary_domain_code !== "other_unknown") {
      const sourceCheck = validateAuthoritativeSourceMinimum(
        profile.sources.filter(
          (source) =>
            source.organization_candidate_id ===
            profile.primary_featured_organization?.organization_candidate_id,
        ),
      );
      errors.push(...sourceCheck.errors);
    }

    if (candidatesOp && candidatesOp.kind === "replace_organization_candidates") {
      const intentIds = new Set(
        candidatesOp.payload.map((candidate) => candidate.organization_candidate_id),
      );
      for (const candidate of profileCandidates) {
        if (!intentIds.has(candidate.organization_candidate_id)) {
          errors.push(
            `organization_profile candidate ${candidate.organization_candidate_id} is missing from replace_organization_candidates`,
          );
        }
      }
    }
    if (sourcesOp && sourcesOp.kind === "replace_organization_sources") {
      const intentSourceIds = new Set(sourcesOp.payload.map((source) => source.organization_source_id));
      const intentSourceKeys = new Set(
        sourcesOp.payload.map(
          (source) => `${source.organization_candidate_id}\u0000${source.normalized_url}`,
        ),
      );
      for (const source of profile.sources) {
        const sourceKey = `${source.organization_candidate_id}\u0000${source.normalized_url}`;
        if (!intentSourceIds.has(source.organization_source_id) && !intentSourceKeys.has(sourceKey)) {
          errors.push(
            `organization_profile source ${source.organization_source_id} is missing from replace_organization_sources`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
