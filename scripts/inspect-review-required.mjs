import { loadEnv } from "./load-env.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId) throw new Error("usage: inspect-review-required <run-id>");

const { query } = await import("../executor/postgres.ts");
const { downloadJsonObject } = await import("../executor/storage.ts");
const {
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
} = await import("../contracts/organization-invariants.ts");
const rows = await query(
  `select artifact_kind, storage_bucket, storage_path
     from public.research_pre_research_artifact
    where run_id = $1
      and artifact_kind = any($2::text[])
    order by artifact_kind`,
  [runId, ["organization_profile", "ingestion_intent"]],
);

for (const row of rows) {
  const { json } = await downloadJsonObject(row.storage_bucket, row.storage_path);
  const candidateOperation = json.operations?.find((operation) =>
    operation.kind === "replace_organization_candidates");
  const sourceOperation = json.operations?.find((operation) =>
    operation.kind === "replace_organization_sources");
  const analysisOperation = json.operations?.find((operation) =>
    operation.kind === "create_video_analysis");
  const candidates = candidateOperation?.payload ?? [];
  const sources = sourceOperation?.payload ?? [];
  const primary = candidates.find((candidate) => candidate.is_primary_featured);
  const organizationValidation = row.artifact_kind === "ingestion_intent"
    ? {
        candidate_set: validateOrganizationCandidateSet(candidates),
        primary_source_minimum: validateAuthoritativeSourceMinimum(
          sources.filter((source) =>
            source.organization_candidate_id === primary?.organization_candidate_id),
        ),
      }
    : undefined;
  console.log(JSON.stringify({
    artifact_kind: row.artifact_kind,
    review_required: json.review_required,
    review_reasons: json.review_reasons,
    unresolved_conflicts: json.unresolved_conflicts,
    primary_domain_code: json.primary_domain_code,
    analysis_overall_confidence: analysisOperation?.payload?.overall_confidence,
    primary_featured_organization: json.primary_featured_organization,
    organization_validation: organizationValidation,
    organizations: json.organizations?.map((organization) => ({
      name: organization.name,
      role: organization.role,
      parent_organization: organization.parent_organization,
      relationship_to_primary: organization.relationship_to_primary,
      aliases: organization.aliases,
    })),
    organization_operations: json.operations?.filter((operation) =>
      operation.kind === "replace_organization_candidates" ||
      operation.kind === "replace_organization_sources"),
  }, null, 2));
}
