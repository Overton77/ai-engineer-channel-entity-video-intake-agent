import { z } from "zod";
import {
  authorityTierSchema,
  organizationSourceRoleSchema,
  researchOrganizationDomainCodeSchema,
  researchOrganizationDomainCodes,
  verificationStatusSchema,
} from "./enums";

export type OrganizationSourceRole = z.infer<typeof organizationSourceRoleSchema>;
export type AuthorityTier = z.infer<typeof authorityTierSchema>;
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type ResearchOrganizationDomainCode = z.infer<typeof researchOrganizationDomainCodeSchema>;

export const identityOwnershipSourceRoles = [
  "official_homepage",
  "official_about",
  "regulatory_or_company_registry",
  "official_press_release",
] as const satisfies readonly OrganizationSourceRole[];

export const implementationTechnicalSourceRoles = [
  "official_product",
  "official_documentation",
  "official_repository",
  "official_research",
  "official_model_or_system_card",
  "official_engineering_blog",
  "official_changelog",
  "standards_specification",
] as const satisfies readonly OrganizationSourceRole[];

export const authoritativeAuthorityTiers = [
  "first_party",
  "official_registry",
  "standards_body",
] as const satisfies readonly AuthorityTier[];

export type InvariantResult = {
  ok: boolean;
  errors: string[];
};

export type AuthoritativeSourceInput = {
  source_role: string;
  authority_tier: string;
  publicly_retrievable: boolean;
  verification_status: string;
  supports?: readonly string[];
};

export type OrganizationCandidateInput = {
  organization_candidate_id?: string;
  normalized_name?: string;
  is_primary_featured: boolean;
  featured_rank: number;
  primary_domain_code: string;
  secondary_domain_codes: readonly string[];
  parent_name?: string | null;
  parent_canonical_url?: string | null;
  relationship_roles?: readonly string[];
};

export function filterOrganizationSourcesForCandidates<
  TSource extends { organization_candidate_id: string },
>(
  candidates: readonly { organization_candidate_id?: string }[],
  sources: readonly TSource[],
): TSource[] {
  const candidateIds = new Set(
    candidates
      .map((candidate) => candidate.organization_candidate_id)
      .filter((value): value is string => Boolean(value)),
  );
  return sources.filter((source) => candidateIds.has(source.organization_candidate_id));
}

/**
 * Model-authored source ranks are advisory ordering hints. Re-number them in
 * packet order so every candidate receives the contiguous, unique ranks the
 * ingestion contract requires. Packet order is stable and preserves the
 * model's intended priority even when it repeats or skips numeric ranks.
 */
export function normalizeOrganizationSourceRanks<
  TSource extends { organization_candidate_id: string; source_rank: number },
>(sources: readonly TSource[]): TSource[] {
  const nextRankByCandidate = new Map<string, number>();
  return sources.map((source) => {
    const nextRank = (nextRankByCandidate.get(source.organization_candidate_id) ?? 0) + 1;
    nextRankByCandidate.set(source.organization_candidate_id, nextRank);
    return { ...source, source_rank: nextRank };
  });
}

/**
 * One public page can legitimately carry more than one model-authored role
 * (most often a startup root page labelled once as homepage and once as
 * product). Postgres intentionally stores one row per candidate/normalized
 * URL, so merge those semantic aliases before persistence. For a root page,
 * retain `official_homepage` and union its implementation support claims; the
 * authoritative-source validator can then assess both facts without a
 * duplicate database row.
 */
export function mergeDuplicateOrganizationSources<
  TSource extends {
    organization_candidate_id: string;
    normalized_url: string;
    source_role: string;
    supports: readonly string[];
    is_required_core_source: boolean;
  },
>(sources: readonly TSource[]): TSource[] {
  const merged: TSource[] = [];
  const indexByKey = new Map<string, number>();
  for (const source of sources) {
    const key = `${source.organization_candidate_id}\u0000${source.normalized_url}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...source } as TSource);
      continue;
    }

    const existing = merged[existingIndex];
    let isRootUrl = false;
    try {
      const parsed = new URL(source.normalized_url);
      isRootUrl = parsed.pathname === "/" || parsed.pathname === "";
    } catch {
      // Schemas reject malformed URLs. Keep deterministic first-row behavior
      // here so this pure normalizer does not introduce a second parse error.
    }
    const preferred =
      isRootUrl &&
      source.source_role === "official_homepage" &&
      existing.source_role !== "official_homepage"
        ? source
        : existing;
    merged[existingIndex] = {
      ...preferred,
      supports: [...new Set([...existing.supports, ...source.supports])],
      is_required_core_source:
        existing.is_required_core_source || source.is_required_core_source,
    } as TSource;
  }
  return merged;
}

const identityOwnershipRoleSet = new Set<string>(identityOwnershipSourceRoles);
const implementationTechnicalRoleSet = new Set<string>(implementationTechnicalSourceRoles);
const authoritativeTierSet = new Set<string>(authoritativeAuthorityTiers);
const domainCodeSet = new Set<string>(researchOrganizationDomainCodes);
const implementationClaimPattern =
  /\b(product|platform|api|sdk|repository|framework|engine|tool(?:ing)?|library|model(?: card)?|system|implementation|documentation|developer)\b/i;

function result(errors: string[]): InvariantResult {
  return { ok: errors.length === 0, errors };
}

export function isQualifyingAuthoritativeSource(source: AuthoritativeSourceInput): boolean {
  return (
    source.publicly_retrievable === true &&
    source.verification_status === "verified" &&
    authoritativeTierSet.has(source.authority_tier)
  );
}

/**
 * Small, single-page company sites frequently use their root homepage as both
 * the identity page and the product page. Preserve the dedicated technical
 * role preference, but allow a verified first-party homepage to satisfy the
 * technical half only when its persisted support claims explicitly describe
 * a product, platform, system, or other implementation. A generic company
 * description remains insufficient.
 */
export function isImplementationTechnicalSource(
  source: AuthoritativeSourceInput,
): boolean {
  if (implementationTechnicalRoleSet.has(source.source_role)) return true;
  return (
    source.source_role === "official_homepage" &&
    (source.supports ?? []).some((claim) => implementationClaimPattern.test(claim))
  );
}

export function validateAuthoritativeSourceMinimum(
  sources: readonly AuthoritativeSourceInput[],
): InvariantResult {
  const errors: string[] = [];
  const qualifying = sources.filter(isQualifyingAuthoritativeSource);
  const hasIdentity = qualifying.some((source) => identityOwnershipRoleSet.has(source.source_role));
  const hasTechnical = qualifying.some(isImplementationTechnicalSource);

  if (!hasIdentity) {
    errors.push(
      "Primary organization requires at least one verified, publicly retrievable identity/ownership source (official homepage/about, registry/filing, or official acquisition/organization announcement)",
    );
  }
  if (!hasTechnical) {
    errors.push(
      "Primary organization requires at least one verified, publicly retrievable implementation-specific technical source (official product, documentation, repository, research/model/system card, engineering blog, changelog, or standards specification)",
    );
  }
  return result(errors);
}

export function validateOrganizationCandidateSet(
  candidates: readonly OrganizationCandidateInput[],
): InvariantResult {
  const errors: string[] = [];
  if (candidates.length === 0) {
    return result(["Organization candidate set must not be empty"]);
  }

  const primaries = candidates.filter((candidate) => candidate.is_primary_featured);
  const rankOnes = candidates.filter((candidate) => candidate.featured_rank === 1);
  if (primaries.length !== 1) {
    errors.push("Exactly one is_primary_featured organization is required");
  }
  if (rankOnes.length !== 1) {
    errors.push("Exactly one featured_rank = 1 organization is required");
  }
  if (primaries.length === 1 && rankOnes.length === 1 && primaries[0] !== rankOnes[0]) {
    errors.push("The primary featured organization must have featured_rank 1");
  }

  const ranks = new Set<number>();
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    const label =
      candidate.normalized_name ??
      candidate.organization_candidate_id ??
      `candidates[${index}]`;

    if (!Number.isInteger(candidate.featured_rank) || candidate.featured_rank < 1) {
      errors.push(`${label}: featured_rank must be an integer >= 1`);
    } else if (ranks.has(candidate.featured_rank)) {
      errors.push(`${label}: featured_rank ${candidate.featured_rank} is duplicated`);
    } else {
      ranks.add(candidate.featured_rank);
    }

    if (candidate.normalized_name) {
      if (names.has(candidate.normalized_name)) {
        errors.push(`${label}: normalized_name is duplicated`);
      } else {
        names.add(candidate.normalized_name);
      }
    }

    if (candidate.organization_candidate_id) {
      if (ids.has(candidate.organization_candidate_id)) {
        errors.push(`${label}: organization_candidate_id is duplicated`);
      } else {
        ids.add(candidate.organization_candidate_id);
      }
    }

    if (!domainCodeSet.has(candidate.primary_domain_code)) {
      errors.push(`${label}: unknown primary_domain_code ${candidate.primary_domain_code}`);
    }
    if (candidate.secondary_domain_codes.length > 2) {
      errors.push(`${label}: at most two secondary organization domains are allowed`);
    }
    const secondarySeen = new Set<string>();
    for (const code of candidate.secondary_domain_codes) {
      if (!domainCodeSet.has(code)) {
        errors.push(`${label}: unknown secondary_domain_code ${code}`);
      }
      if (code === candidate.primary_domain_code) {
        errors.push(`${label}: secondary domains must not repeat the primary domain`);
      }
      if (secondarySeen.has(code)) {
        errors.push(`${label}: duplicate secondary_domain_code ${code}`);
      }
      secondarySeen.add(code);
    }

    if (candidate.parent_name && !candidate.parent_canonical_url) {
      errors.push(`${label}: parent_name requires parent_canonical_url`);
    }

    if (
      candidate.is_primary_featured &&
      candidate.relationship_roles &&
      !candidate.relationship_roles.includes("primary_featured_organization")
    ) {
      errors.push(
        `${label}: primary featured organization must include relationship role primary_featured_organization`,
      );
    }
    if (
      !candidate.is_primary_featured &&
      candidate.relationship_roles?.includes("primary_featured_organization")
    ) {
      errors.push(
        `${label}: non-primary organization must not include relationship role primary_featured_organization`,
      );
    }
  }

  return result(errors);
}
