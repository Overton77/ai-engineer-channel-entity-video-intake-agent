import type { IngestionIntent } from "./ingestion-intent";
import {
  filterOrganizationSourcesForCandidates,
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
} from "./organization-invariants";
import type { OrganizationProfile } from "./pre-research-packet";

type ReviewProfile = Pick<
  OrganizationProfile,
  | "primary_featured_organization"
  | "primary_domain_code"
  | "review_reasons"
  | "sources"
  | "unresolved_conflicts"
>;

const hierarchyTopicPattern =
  /\b(parent company|parent organization|subsidiar(?:y|ies)|ownership|acqui(?:red|sition)|merger|corporate hierarchy|legal entity conflict|speaker employer)\b/i;
const unresolvedLanguagePattern =
  /\b(ambiguous|ambiguity|conflict(?:ing)?|contradict(?:ion|ory)|disputed|inconsistent|unclear|unknown|unresolved|whether|cannot verify|can't verify|could not verify|unable to verify|needs? (?:manual )?(?:confirmation|review))\b/i;

function isExplicitlyNonIdentityConflict(value: string): boolean {
  return /does not affect organization identification/i.test(value);
}

export function isOrganizationHierarchyTopic(value: string): boolean {
  return !isExplicitlyNonIdentityConflict(value) && hierarchyTopicPattern.test(value);
}

export function isOrganizationHierarchyConflict(value: string): boolean {
  return isOrganizationHierarchyTopic(value) && unresolvedLanguagePattern.test(value);
}

export function organizationProfileHasHierarchyConflict(
  profile: Pick<ReviewProfile, "review_reasons" | "unresolved_conflicts"> | null,
): boolean {
  // Entries in unresolved_conflicts are unresolved by definition. Review
  // reasons are broader advisory metadata, so require explicit uncertainty
  // language before treating their hierarchy terms as a blocker.
  return (
    (profile?.unresolved_conflicts ?? []).some(isOrganizationHierarchyTopic)
    || (profile?.review_reasons ?? []).some(isOrganizationHierarchyConflict)
  );
}

export function automaticReviewReasons(input: {
  intent: IngestionIntent;
  profile: ReviewProfile | null;
  runStatus?: string;
}): string[] {
  const reasons: string[] = [];
  if (input.runStatus === "review_required") reasons.push("run status is review_required");
  if (!input.profile) {
    reasons.push("organization profile is missing");
  } else if (organizationProfileHasHierarchyConflict(input.profile)) {
    reasons.push("unresolved organization hierarchy conflicts");
  }

  const analysis = input.intent.operations.find(
    (operation) => operation.kind === "create_video_analysis",
  );
  if (
    analysis?.kind === "create_video_analysis"
    && analysis.payload.overall_confidence < 0.7
  ) {
    reasons.push("overall_confidence_below_0.70");
  }

  const candidatesOperation = input.intent.operations.find(
    (operation) => operation.kind === "replace_organization_candidates",
  );
  const sourcesOperation = input.intent.operations.find(
    (operation) => operation.kind === "replace_organization_sources",
  );
  const candidates = candidatesOperation?.kind === "replace_organization_candidates"
    ? candidatesOperation.payload
    : [];
  const sources = sourcesOperation?.kind === "replace_organization_sources"
    ? sourcesOperation.payload
    : [];
  const knownCandidateSources = filterOrganizationSourcesForCandidates(candidates, sources);
  const candidateCheck = validateOrganizationCandidateSet(candidates);
  reasons.push(...candidateCheck.errors);
  const primary = candidates.find((candidate) => candidate.is_primary_featured);
  if (!primary) {
    reasons.push("primary featured organization is missing");
  } else if (primary.primary_domain_code === "other_unknown") {
    reasons.push("primary organization domain is other_unknown");
  } else {
    const sourceCheck = validateAuthoritativeSourceMinimum(
      knownCandidateSources.filter(
        (source) => source.organization_candidate_id === primary.organization_candidate_id,
      ),
    );
    reasons.push(...sourceCheck.errors);
  }

  const profileDomain =
    input.profile?.primary_featured_organization?.primary_domain_code
    ?? input.profile?.primary_domain_code;
  if (profileDomain === "other_unknown") {
    reasons.push("organization profile primary_domain_code is other_unknown");
  }
  return [...new Set(reasons)];
}
