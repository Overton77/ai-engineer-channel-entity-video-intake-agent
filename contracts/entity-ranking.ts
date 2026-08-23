import { z } from "zod";

export const discoveryEntityKinds = [
  "engineer",
  "organization",
  "software_product",
  "library",
  "repository",
  "paper",
  "talk_video_report",
] as const;

export const discoveryEntityKindSchema = z.enum(discoveryEntityKinds);

export const metricMissingnessSchema = z.enum([
  "observed",
  "structural",
  "unavailable",
  "not_collected",
  "stale",
]);

export const metricSourceClassSchema = z.enum([
  "official_api",
  "official_registry",
  "primary_artifact",
  "secondary_index",
  "independently_corroborated_secondary",
  "self_reported",
  "model_inferred_discovery_only",
]);

export const metricObservationSchema = z.object({
  observation_id: z.string().min(1),
  entity_id: z.string().min(1),
  entity_kind: discoveryEntityKindSchema,
  metric_key: z.string().regex(/^[a-z0-9]+(?:[._][a-z0-9]+)+$/),
  value: z.union([z.number().finite(), z.string(), z.boolean()]),
  unit: z.string().min(1),
  scope: z.record(z.string(), z.string()),
  source_class: metricSourceClassSchema,
  source_locator: z.string().url(),
  source_record_id: z.string().min(1).optional(),
  collector: z.string().min(1),
  collection_method: z.string().min(1),
  observed_at: z.string().datetime({ offset: true }),
  effective_at: z.string().datetime({ offset: true }).optional(),
  window_start: z.string().datetime({ offset: true }).optional(),
  window_end: z.string().datetime({ offset: true }).optional(),
  raw_artifact_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  identity_resolution_id: z.string().min(1),
  source_reliability: z.number().min(0).max(1),
  identity_confidence: z.number().min(0).max(1),
  measurement_error: z.number().min(0).max(1).optional(),
  terms_or_access_note: z.string().min(1).optional(),
  supersedes_observation_id: z.string().min(1).optional(),
});

export const entityFeatureSchema = z.object({
  snapshot_id: z.string().min(1),
  entity_id: z.string().min(1),
  as_of: z.string().datetime({ offset: true }),
  feature_key: z.string().regex(/^[a-z0-9]+(?:[._][a-z0-9]+)+$/),
  raw_value: z.number().finite().optional(),
  transformed_value: z.number().min(0).max(1),
  posterior_mean: z.number().min(0).max(1),
  posterior_sd: z.number().min(0),
  cohort_id: z.string().min(1),
  transform_version: z.string().min(1),
  observation_ids: z.array(z.string().min(1)),
  missingness: metricMissingnessSchema,
  manipulation_risk: z.number().min(0).max(1),
});

export const rankingPurposes = [
  "research_next",
  "curriculum_inclusion",
  "production_watch",
  "claim_authority",
] as const;

export const rankingPurposeSchema = z.enum(rankingPurposes);

export const entityRankingSnapshotSchema = z.object({
  ranking_snapshot_id: z.string().min(1),
  campaign_id: z.string().min(1),
  entity_id: z.string().min(1),
  entity_kind: discoveryEntityKindSchema,
  purpose: rankingPurposeSchema,
  audience: z.string().min(1),
  as_of: z.string().datetime({ offset: true }),
  policy_version: z.string().min(1),
  taxonomy_version: z.string().min(1),
  cohort_ids: z.array(z.string().min(1)),
  point_score: z.number().min(0).max(1),
  conservative_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  interval_90: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  direct_only_score: z.number().min(0).max(1),
  propagation_contribution: z.number().min(-0.15).max(0.15),
  feature_contributions: z.record(z.string(), z.number().finite()),
  missing_features: z.array(z.string()),
  penalties: z.record(z.string(), z.number().min(0)),
  explanation_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)),
  observation_ids: z.array(z.string().min(1)),
  eligible: z.boolean(),
  ineligibility_reasons: z.array(z.string()),
  rank: z.number().int().positive().optional(),
});

export type DiscoveryEntityKind = z.infer<typeof discoveryEntityKindSchema>;
export type MetricObservation = z.infer<typeof metricObservationSchema>;
export type EntityFeature = z.infer<typeof entityFeatureSchema>;
export type EntityRankingSnapshot = z.infer<typeof entityRankingSnapshotSchema>;
