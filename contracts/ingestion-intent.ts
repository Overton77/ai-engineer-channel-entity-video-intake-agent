import { z } from "zod";
import { hashCanonicalJson } from "../lib/hash";
import {
  authorityTierSchema,
  confidenceSchema,
  contentFormSchema,
  difficultySchema,
  engineeringCategoryCodeSchema,
  entityKindSchema,
  evidenceGradeSchema,
  evidenceLevelSchema,
  evidenceSourceKindSchema,
  implementationTypeSchema,
  INTENT_SCHEMA_VERSION,
  lifecycleStageSchema,
  organizationScopeSchema,
  organizationSourceRoleSchema,
  PACKET_SCHEMA_VERSION,
  primaryTechnologyKindSchema,
  researchOrganizationDomainCodeSchema,
  resourceTypeSchema,
  sha256Schema,
  temporalStatusSchema,
  V1_INTENT_SCHEMA_VERSION,
  verificationStatusSchema,
  videoOrganizationRoleSchema,
} from "./enums";
import {
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
} from "./organization-invariants";

export const intentOperationKindsV1 = [
  "create_video_analysis",
  "replace_category_assignments",
  "replace_domain_assignments",
  "replace_lifecycle_assignments",
  "upsert_resource_candidates",
  "upsert_entity_candidates",
  "replace_evidence_anchors",
  "record_web_search_events",
] as const;

export const intentOperationKinds = [
  "create_video_analysis",
  "create_contextualized_initial_summary",
  "replace_technology_library_summaries",
  "replace_category_assignments",
  "replace_domain_assignments",
  "replace_lifecycle_assignments",
  "replace_evidence_anchors",
  "replace_organization_candidates",
  "replace_organization_sources",
  "upsert_resource_candidates",
  "upsert_entity_candidates",
  "record_web_search_events",
] as const;

export const intentOperationKindV1Schema = z.enum(intentOperationKindsV1);
export const intentOperationKindSchema = z.enum(intentOperationKinds);

export const webSearchSubagentSchema = z.enum([
  "organization_researcher",
  "web_context_scout",
  "source_verifier",
]);

const evidenceAnchorPayloadSchema = z.object({
  evidence_id: z.uuid(),
  source_kind: evidenceSourceKindSchema,
  source_url: z.url().nullable(),
  transcript_segment: z.string().nullable(),
  start_seconds: z.number().nullable(),
  end_seconds: z.number().nullable(),
  start_character: z.number().int().nullable(),
  end_character: z.number().int().nullable(),
  short_excerpt: z.string().min(1).max(400),
  supports: z.string().min(1),
});

const createVideoAnalysisPayloadSchema = z.object({
  initial_summary: z.string().min(200).max(1200),
  structured_summary: z.string().min(400).max(4000),
  contextualized_abstract: z.string().min(200).max(2000),
  why_it_matters: z.string().min(40).max(1200),
  key_takeaways: z.array(z.string().min(1)).min(5).max(10),
  concepts: z.array(z.string().min(1)).max(30),
  prerequisites: z.array(z.string().min(1)).max(20),
  learning_outcomes: z.array(z.string().min(1)).max(20),
  limitations: z.array(z.string().min(1)).max(20),
  quantitative_claims: z.array(z.string().min(1)).max(20),
  demonstrations: z.array(z.string().min(1)).max(20),
  curriculum_roles: z.array(z.string().min(1)).max(10),
  challenge_seeds: z.array(z.string().min(1)).max(10),
  difficulty: difficultySchema,
  content_form: contentFormSchema,
  evidence_level: evidenceLevelSchema,
  overall_confidence: confidenceSchema,
});

const categoryAssignmentPayloadSchema = z.object({
  category_code: engineeringCategoryCodeSchema,
  assignment_role: z.enum(["primary", "secondary"]),
  confidence: confidenceSchema,
  rationale: z.string().min(1),
  alternative_rank: z.number().int().min(1).nullable(),
});

const domainAssignmentPayloadSchema = z.object({
  domain_code: z.string().min(1),
  confidence: confidenceSchema,
  rationale: z.string().min(1),
});

const resourceCandidatePayloadSchema = z.object({
  resource_type: resourceTypeSchema,
  title: z.string().min(1),
  url: z.url(),
  normalized_url: z.string().min(1),
  publisher: z.string().min(1).nullable(),
  relationship_to_video: z.string().min(1),
  why_valuable: z.string().min(1),
  verification_status: verificationStatusSchema,
  is_first_party: z.boolean(),
  license: z.string().nullable(),
  confidence: confidenceSchema,
  evidence_ids: z.array(z.uuid()),
});

const entityCandidatePayloadSchema = z.object({
  entity_kind: entityKindSchema,
  name: z.string().min(1),
  normalized_name: z.string().min(1),
  canonical_url: z.url().nullable(),
  organization_name: z.string().min(1).nullable(),
  relationship_to_video: z.string().min(1),
  confidence: confidenceSchema,
  verification_status: verificationStatusSchema,
  evidence_ids: z.array(z.uuid()),
});

const webSearchEventPayloadV1Schema = z.object({
  subagent: z.enum(["web_context_scout", "source_verifier"]),
  query: z.string().min(1),
  provider: z.literal("exa"),
  searched_at: z.iso.datetime(),
  result_urls: z.array(z.url()),
  selected_urls: z.array(z.url()),
  search_purpose: z.string().min(1),
});

const webSearchEventPayloadSchema = z.object({
  subagent: webSearchSubagentSchema,
  query: z.string().min(1),
  provider: z.literal("exa"),
  searched_at: z.iso.datetime(),
  result_urls: z.array(z.url()),
  selected_urls: z.array(z.url()),
  search_purpose: z.string().min(1),
});

export const conceptItemSchema = z.object({
  name: z.string().min(1),
  explanation: z.string().min(1),
  importance: z.string().min(1),
  evidence_ids: z.array(z.uuid()).min(1),
  evidence_grade: evidenceGradeSchema,
});

export const externalContextNoteSchema = z.object({
  note: z.string().min(1),
  evidence_ids: z.array(z.uuid()),
  evidence_grade: evidenceGradeSchema,
});

export const initialSummaryContentSchema = z.object({
  transcript_summary: z.string().min(200).max(4000),
  software_engineering_concepts: z.array(conceptItemSchema).max(30),
  ai_concepts: z.array(conceptItemSchema).max(30),
  why_concepts_matter_together: z.string().min(1),
  external_context_notes: z.array(externalContextNoteSchema).max(30),
  temporal_context: z.string().min(1),
  transcript_web_disagreement_note: z.string().min(1).nullable(),
  evidence_ids: z.array(z.uuid()),
});

export const relatedTechnologySchema = z.object({
  name: z.string().min(1),
  kind: primaryTechnologyKindSchema,
  relationship_to_primary: z.string().min(1),
  evidence_ids: z.array(z.uuid()),
});

export const technologyImplementationSchema = z.object({
  name: z.string().min(1),
  implementation_type: implementationTypeSchema,
  implementing_organization_candidate_id: z.uuid().nullable(),
  relationship_to_technology: z.string().min(1),
  role_in_video: z.string().min(1),
  current_status: z.string().min(1),
  official_url: z.url().nullable(),
  evidence_ids: z.array(z.uuid()),
  confidence: confidenceSchema,
});

export const technologyFamilySchema = z.object({
  family_rank: z.number().int().min(1),
  family_label: z.string().min(1),
  primary_technology: z.string().min(1),
  primary_technology_kind: primaryTechnologyKindSchema,
  related_technologies: z.array(relatedTechnologySchema),
  implementations: z.array(technologyImplementationSchema),
  summary: z.string().min(1),
  relationship_rationale: z.string().min(1),
  role_in_video: z.string().min(1),
  current_status: z.string().min(1),
  temporal_status: temporalStatusSchema,
  official_urls: z.array(z.url()),
  evidence_ids: z.array(z.uuid()),
  confidence: confidenceSchema,
});

export const technologyLibrarySummaryContentSchema = z
  .object({
    families: z.array(technologyFamilySchema).max(8),
    no_main_technology_reason: z.string().min(1).nullable(),
  })
  .refine((value) => value.families.length > 0 || value.no_main_technology_reason !== null, {
    message: "no_main_technology_reason is required when families is empty",
  })
  .refine(
    (value) => {
      const ranks = value.families.map((family) => family.family_rank);
      return new Set(ranks).size === ranks.length;
    },
    { message: "technology family_rank values must be unique" },
  );

export const organizationCandidatePayloadSchema = z.object({
  organization_candidate_id: z.uuid(),
  canonical_name: z.string().min(1),
  normalized_name: z.string().min(1),
  organization_scope: organizationScopeSchema,
  relationship_roles: z.array(videoOrganizationRoleSchema).min(1),
  is_primary_featured: z.boolean(),
  featured_rank: z.number().int().min(1),
  primary_domain_code: researchOrganizationDomainCodeSchema,
  secondary_domain_codes: z.array(researchOrganizationDomainCodeSchema).max(2),
  parent_name: z.string().min(1).nullable(),
  parent_canonical_url: z.url().nullable(),
  official_url: z.url(),
  authoritative_summary: z.string().min(1),
  relationship_to_implementation: z.string().min(1),
  current_status: z.string().min(1),
  status_as_of: z.iso.date(),
  video_time_name: z.string().min(1).nullable(),
  video_time_parent_name: z.string().min(1).nullable(),
  ownership_changed_since_video: z.boolean(),
  confidence: confidenceSchema,
  evidence_ids: z.array(z.uuid()),
});

export const organizationSourcePayloadSchema = z.object({
  organization_source_id: z.uuid(),
  organization_candidate_id: z.uuid(),
  source_rank: z.number().int().min(1),
  source_role: organizationSourceRoleSchema,
  authority_tier: authorityTierSchema,
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  normalized_url: z.string().min(1),
  publicly_retrievable: z.boolean(),
  retrieved_at: z.iso.datetime(),
  source_published_at: z.iso.datetime().nullable(),
  supports: z.array(z.string().min(1)),
  verification_status: verificationStatusSchema,
  is_required_core_source: z.boolean(),
  evidence_id: z.uuid().nullable(),
});

export const parentOrganizationSchema = z.object({
  canonical_name: z.string().min(1),
  official_url: z.url().nullable(),
  relationship_summary: z.string().min(1),
  evidence_ids: z.array(z.uuid()),
});

export const speakerEmployerSchema = z.object({
  canonical_name: z.string().min(1),
  official_url: z.url().nullable(),
  evidence_ids: z.array(z.uuid()),
});

export const featuredImplementationSchema = z.object({
  name: z.string().min(1),
  relationship_to_organization: z.string().min(1),
  evidence_ids: z.array(z.uuid()),
});

const categoryAssignmentsSchema = z
  .array(categoryAssignmentPayloadSchema)
  .min(1)
  .max(4)
  .refine((rows) => rows.filter((row) => row.assignment_role === "primary").length === 1, {
    message: "Exactly one primary category is required",
  })
  .refine((rows) => rows.filter((row) => row.assignment_role === "secondary").length <= 3, {
    message: "At most three secondary categories are allowed",
  });

export const intentOperationV1Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_video_analysis"),
    payload: createVideoAnalysisPayloadSchema,
  }),
  z.object({
    kind: z.literal("replace_category_assignments"),
    payload: categoryAssignmentsSchema,
  }),
  z.object({
    kind: z.literal("replace_domain_assignments"),
    payload: z.array(domainAssignmentPayloadSchema).min(1).max(6),
  }),
  z.object({
    kind: z.literal("replace_lifecycle_assignments"),
    payload: z.array(lifecycleStageSchema).min(1).max(7),
  }),
  z.object({
    kind: z.literal("upsert_resource_candidates"),
    payload: z.array(resourceCandidatePayloadSchema).max(25),
  }),
  z.object({
    kind: z.literal("upsert_entity_candidates"),
    payload: z.array(entityCandidatePayloadSchema).max(25),
  }),
  z.object({
    kind: z.literal("replace_evidence_anchors"),
    payload: z.array(evidenceAnchorPayloadSchema).min(1).max(80),
  }),
  z.object({
    kind: z.literal("record_web_search_events"),
    payload: z.array(webSearchEventPayloadV1Schema).max(20),
  }),
]);

const organizationCandidatesOperationSchema = z
  .array(organizationCandidatePayloadSchema)
  .max(20)
  .superRefine((candidates, ctx) => {
    const check = validateOrganizationCandidateSet(candidates);
    for (const message of check.errors) {
      ctx.addIssue({ code: "custom", message });
    }
  });

const organizationSourcesOperationSchema = z
  .array(organizationSourcePayloadSchema)
  .max(40)
  .superRefine((sources, ctx) => {
    const ranksByCandidate = new Map<string, Set<number>>();
    const urlsByCandidate = new Map<string, Set<string>>();
    for (const source of sources) {
      const ranks = ranksByCandidate.get(source.organization_candidate_id) ?? new Set<number>();
      if (ranks.has(source.source_rank)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate source_rank ${source.source_rank} for organization ${source.organization_candidate_id}`,
        });
      }
      ranks.add(source.source_rank);
      ranksByCandidate.set(source.organization_candidate_id, ranks);

      const urls = urlsByCandidate.get(source.organization_candidate_id) ?? new Set<string>();
      if (urls.has(source.normalized_url)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate normalized_url for organization ${source.organization_candidate_id}`,
        });
      }
      urls.add(source.normalized_url);
      urlsByCandidate.set(source.organization_candidate_id, urls);
    }
  });

export const intentOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_video_analysis"),
    payload: createVideoAnalysisPayloadSchema,
  }),
  z.object({
    kind: z.literal("create_contextualized_initial_summary"),
    payload: initialSummaryContentSchema,
  }),
  z.object({
    kind: z.literal("replace_technology_library_summaries"),
    payload: technologyLibrarySummaryContentSchema,
  }),
  z.object({
    kind: z.literal("replace_category_assignments"),
    payload: categoryAssignmentsSchema,
  }),
  z.object({
    kind: z.literal("replace_domain_assignments"),
    payload: z.array(domainAssignmentPayloadSchema).min(1).max(6),
  }),
  z.object({
    kind: z.literal("replace_lifecycle_assignments"),
    payload: z.array(lifecycleStageSchema).min(1).max(7),
  }),
  z.object({
    kind: z.literal("replace_evidence_anchors"),
    payload: z.array(evidenceAnchorPayloadSchema).min(1).max(80),
  }),
  z.object({
    kind: z.literal("replace_organization_candidates"),
    payload: organizationCandidatesOperationSchema,
  }),
  z.object({
    kind: z.literal("replace_organization_sources"),
    payload: organizationSourcesOperationSchema,
  }),
  z.object({
    kind: z.literal("upsert_resource_candidates"),
    payload: z.array(resourceCandidatePayloadSchema).max(25),
  }),
  z.object({
    kind: z.literal("upsert_entity_candidates"),
    payload: z.array(entityCandidatePayloadSchema).max(25),
  }),
  z.object({
    kind: z.literal("record_web_search_events"),
    payload: z.array(webSearchEventPayloadSchema).max(40),
  }),
]);

function operationsFollowAllowlistOrder(
  operations: readonly { kind: string }[],
  allowlist: readonly string[],
): boolean {
  let lastIndex = -1;
  const seen = new Set<string>();
  for (const operation of operations) {
    const index = allowlist.indexOf(operation.kind);
    if (index === -1 || index < lastIndex || seen.has(operation.kind)) {
      return false;
    }
    seen.add(operation.kind);
    lastIndex = index;
  }
  return true;
}

export const ingestionIntentV1Schema = z.object({
  schema_version: z.literal(V1_INTENT_SCHEMA_VERSION),
  intent_id: z.uuid(),
  idempotency_key: sha256Schema,
  source: z.object({
    video_id: z.string().min(1),
    run_id: z.uuid(),
    transcript_sha256: sha256Schema,
    taxonomy_version: z.string().min(1),
    prompt_bundle_version: z.string().min(1),
    model_id: z.literal("zai/glm-5.2"),
  }),
  evidence_grades_used: z.array(evidenceGradeSchema).min(1),
  operations: z.array(intentOperationV1Schema).min(1),
});

export const ingestionIntentSchema = z
  .object({
    schema_version: z.literal(INTENT_SCHEMA_VERSION),
    intent_id: z.uuid(),
    idempotency_key: sha256Schema,
    source: z.object({
      video_id: z.string().min(1),
      run_id: z.uuid(),
      transcript_sha256: sha256Schema,
      taxonomy_version: z.string().min(1),
      prompt_bundle_version: z.string().min(1),
      model_id: z.literal("zai/glm-5.2"),
      research_as_of: z.iso.date(),
      packet_schema_version: z.literal(PACKET_SCHEMA_VERSION),
    }),
    evidence_grades_used: z.array(evidenceGradeSchema).min(1),
    operations: z
      .array(intentOperationSchema)
      .min(1)
      .refine((operations) => operationsFollowAllowlistOrder(operations, intentOperationKinds), {
        message: "v2 operations must appear in allowlist order and each kind at most once",
      }),
  })
  .superRefine((intent, ctx) => {
    const candidatesOp = intent.operations.find(
      (operation) => operation.kind === "replace_organization_candidates",
    );
    const sourcesOp = intent.operations.find(
      (operation) => operation.kind === "replace_organization_sources",
    );
    if (!candidatesOp || candidatesOp.kind !== "replace_organization_candidates") {
      return;
    }
    const candidates = candidatesOp.payload;
    const primary = candidates.find((candidate) => candidate.is_primary_featured);
    if (!primary || !sourcesOp || sourcesOp.kind !== "replace_organization_sources") {
      return;
    }
    if (primary.primary_domain_code === "other_unknown") {
      return;
    }
    const primarySources = sourcesOp.payload.filter(
      (source) => source.organization_candidate_id === primary.organization_candidate_id,
    );
    const check = validateAuthoritativeSourceMinimum(primarySources);
    for (const message of check.errors) {
      ctx.addIssue({ code: "custom", message });
    }
  });

export const ingestionIntentV2Schema = ingestionIntentSchema;
export const ingestionIntentAnySchema = z.union([ingestionIntentV1Schema, ingestionIntentV2Schema]);

export type IngestionIntentV1 = z.infer<typeof ingestionIntentV1Schema>;
export type IngestionIntent = z.infer<typeof ingestionIntentSchema>;
export type IntentOperation = z.infer<typeof intentOperationSchema>;
export type IntentOperationV1 = z.infer<typeof intentOperationV1Schema>;
export type ParsedIngestionIntent = IngestionIntentV1 | IngestionIntent;
export type InitialSummaryContent = z.infer<typeof initialSummaryContentSchema>;
export type TechnologyLibrarySummaryContent = z.infer<typeof technologyLibrarySummaryContentSchema>;
export type OrganizationCandidatePayload = z.infer<typeof organizationCandidatePayloadSchema>;
export type OrganizationSourcePayload = z.infer<typeof organizationSourcePayloadSchema>;

export function parseIngestionIntent(json: unknown): ParsedIngestionIntent {
  const version = z.object({ schema_version: z.string() }).parse(json).schema_version;
  if (version === V1_INTENT_SCHEMA_VERSION) {
    return ingestionIntentV1Schema.parse(json);
  }
  if (version === INTENT_SCHEMA_VERSION) {
    return ingestionIntentSchema.parse(json);
  }
  throw new Error(`Unsupported intent schema_version: ${version}`);
}

export function computeIntentIdempotencyKey(material: {
  schema_version: string;
  source: unknown;
  evidence_grades_used: unknown;
  operations: unknown;
}): string {
  return hashCanonicalJson({
    schema_version: material.schema_version,
    source: material.source,
    evidence_grades_used: material.evidence_grades_used,
    operations: material.operations,
  });
}
