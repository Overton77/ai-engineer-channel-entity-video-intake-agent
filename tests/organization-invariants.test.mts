// Tests for: organization-invariants — primary/rank, secondary domains, and source minimum
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterOrganizationSourcesForCandidates,
  isImplementationTechnicalSource,
  mergeDuplicateOrganizationSources,
  normalizeOrganizationSourceRanks,
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
  type AuthoritativeSourceInput,
  type OrganizationCandidateInput,
} from "../contracts/organization-invariants";
import {
  filterKnownEvidenceIds,
  sameNullableInstant,
} from "../contracts/pre-research-packet";
import {
  effectiveOrganizationProfile,
  organizationStageInputSchema,
  technologyStageInputSchema,
} from "../agent/tools/save_synthesis_stage_packet";

describe("model-facing nullable synthesis inputs", () => {
  it("normalizes GLM's exact top-level string null sentinel before strict packet parsing", () => {
    assert.equal(organizationStageInputSchema.shape.parent_organization.parse("null"), null);
    assert.equal(organizationStageInputSchema.shape.no_organization_reason.parse("null"), null);
    assert.equal(organizationStageInputSchema.shape.speaker_employer.parse("null"), null);
    assert.equal(technologyStageInputSchema.shape.no_main_technology_reason.parse("null"), null);
  });

  it("preserves real nullable values and rejects other string sentinels for object fields", () => {
    assert.equal(organizationStageInputSchema.shape.parent_organization.parse(null), null);
    assert.throws(
      () => organizationStageInputSchema.shape.parent_organization.parse("none"),
      /valid JSON object/i,
    );
  });

  it("decodes and strictly validates GLM's stringified top-level object arguments", () => {
    const primary = {
      organization_candidate_id: "11111111-1111-4111-8111-111111111111",
      canonical_name: "Auditoria.AI",
      normalized_name: "auditoria.ai",
      organization_scope: "independent_company",
      relationship_roles: ["primary_featured_organization", "speaker_employer"],
      is_primary_featured: true,
      featured_rank: 1,
      primary_domain_code: "vertical_ai_application",
      secondary_domain_codes: [],
      parent_name: null,
      parent_canonical_url: null,
      official_url: "https://auditoria.ai/",
      authoritative_summary: "AI automation for corporate finance teams.",
      relationship_to_implementation: "Developer of the featured finance agent.",
      current_status: "Active",
      status_as_of: "2026-08-23",
      video_time_name: "Auditoria.AI",
      video_time_parent_name: null,
      ownership_changed_since_video: false,
      confidence: 0.95,
      evidence_ids: [],
    };
    const parsedPrimary = organizationStageInputSchema.shape.primary_featured_organization.parse(
      JSON.stringify(primary),
    );
    assert.deepEqual(parsedPrimary, primary);
    assert.throws(
      () => organizationStageInputSchema.shape.primary_featured_organization.parse('{"canonical_name":1}'),
      /failed validation/i,
    );
    assert.throws(
      () => organizationStageInputSchema.shape.primary_featured_organization.parse("not-json"),
      /valid JSON object/i,
    );

    const legacy = {
      primary_featured_organization: null,
      other_organizations: [parsedPrimary!],
      primary_domain_code: "other_unknown" as const,
      secondary_domain_codes: [],
      no_organization_reason: "Provider stringified the primary object.",
      review_reasons: [
        "FRAMEWORK_LIMITATION: primary object could not be passed due to framework serialization limitation.",
        "Publication date should be checked.",
      ],
      unresolved_conflicts: [
        "FRAMEWORK_LIMITATION: speaker employer was stringified by the framework limitation.",
        "Technology naming differs between the transcript and product page.",
      ],
    };
    const effective = effectiveOrganizationProfile(legacy);
    assert.deepEqual(effective.primary_featured_organization, parsedPrimary);
    assert.deepEqual(effective.other_organizations, []);
    assert.equal(effective.primary_domain_code, "vertical_ai_application");
    assert.equal(effective.no_organization_reason, null);
    assert.deepEqual(effective.review_reasons, ["Publication date should be checked."]);
    assert.deepEqual(effective.unresolved_conflicts, [
      "Technology naming differs between the transcript and product page.",
    ]);
  });

  it("does not promote ambiguous or genuinely organization-less legacy profiles", () => {
    const noOrganization = {
      primary_featured_organization: null,
      other_organizations: [],
      primary_domain_code: "other_unknown" as const,
      secondary_domain_codes: [],
      no_organization_reason: "No organization was identified.",
      review_reasons: ["No organization was identified."],
      unresolved_conflicts: [],
    };
    assert.equal(effectiveOrganizationProfile(noOrganization), noOrganization);
  });
});

describe("filterKnownEvidenceIds", () => {
  it("keeps only registered anchors and deduplicates them", () => {
    const known = new Set([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
    assert.deepEqual(
      filterKnownEvidenceIds(
        [
          "11111111-1111-4111-8111-111111111111",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ],
        known,
      ),
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    );
  });
});

describe("filterOrganizationSourcesForCandidates", () => {
  it("drops sources whose model-authored parent ID is absent from the candidate set", () => {
    const candidates = [{ organization_candidate_id: "candidate-a" }];
    const sources = [
      { organization_candidate_id: "candidate-a", title: "kept" },
      { organization_candidate_id: "placeholder-orphan", title: "dropped" },
    ];
    assert.deepEqual(filterOrganizationSourcesForCandidates(candidates, sources), [sources[0]]);
  });
});

describe("normalizeOrganizationSourceRanks", () => {
  it("assigns unique contiguous ranks per organization while preserving packet order", () => {
    const sources = [
      { organization_candidate_id: "candidate-a", source_rank: 1, title: "a1" },
      { organization_candidate_id: "candidate-b", source_rank: 3, title: "b1" },
      { organization_candidate_id: "candidate-a", source_rank: 1, title: "a2" },
      { organization_candidate_id: "candidate-b", source_rank: 3, title: "b2" },
    ];

    assert.deepEqual(normalizeOrganizationSourceRanks(sources), [
      { organization_candidate_id: "candidate-a", source_rank: 1, title: "a1" },
      { organization_candidate_id: "candidate-b", source_rank: 1, title: "b1" },
      { organization_candidate_id: "candidate-a", source_rank: 2, title: "a2" },
      { organization_candidate_id: "candidate-b", source_rank: 2, title: "b2" },
    ]);
    assert.equal(sources[2].source_rank, 1, "normalization must not mutate the profile artifact");
  });
});

describe("mergeDuplicateOrganizationSources", () => {
  it("merges duplicate root product/homepage rows and preserves their combined evidence", () => {
    const merged = mergeDuplicateOrganizationSources([
      {
        organization_candidate_id: "candidate-a",
        organization_source_id: "source-product",
        normalized_url: "https://example.com/",
        source_role: "official_product",
        authority_tier: "first_party",
        publicly_retrievable: true,
        verification_status: "verified",
        supports: ["Research Replay is a self-service platform"],
        is_required_core_source: true,
      },
      {
        organization_candidate_id: "candidate-a",
        organization_source_id: "source-homepage",
        normalized_url: "https://example.com/",
        source_role: "official_homepage",
        authority_tier: "first_party",
        publicly_retrievable: true,
        verification_status: "verified",
        supports: ["Example is the official company identity"],
        is_required_core_source: false,
      },
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].source_role, "official_homepage");
    assert.equal(merged[0].organization_source_id, "source-homepage");
    assert.equal(merged[0].is_required_core_source, true);
    assert.deepEqual(merged[0].supports, [
      "Research Replay is a self-service platform",
      "Example is the official company identity",
    ]);
    assert.equal(isImplementationTechnicalSource(merged[0]), true);
  });
});

describe("sameNullableInstant", () => {
  it("treats equivalent ISO timestamp precision as the same publication instant", () => {
    assert.equal(
      sameNullableInstant("2026-07-28T00:59:04Z", "2026-07-28T00:59:04.000Z"),
      true,
    );
    assert.equal(
      sameNullableInstant("2026-07-28T00:59:05Z", "2026-07-28T00:59:04.000Z"),
      false,
    );
    assert.equal(sameNullableInstant(null, null), true);
  });
});

function candidate(
  overrides: Partial<OrganizationCandidateInput> = {},
): OrganizationCandidateInput {
  return {
    organization_candidate_id: "11111111-1111-4111-8111-111111111111",
    normalized_name: "github",
    is_primary_featured: true,
    featured_rank: 1,
    primary_domain_code: "coding_agents_developer_tools",
    secondary_domain_codes: ["ai_developer_platform_sdk"],
    ...overrides,
  };
}

function source(overrides: Partial<AuthoritativeSourceInput> = {}): AuthoritativeSourceInput {
  return {
    source_role: "official_homepage",
    authority_tier: "first_party",
    publicly_retrievable: true,
    verification_status: "verified",
    ...overrides,
  };
}

describe("validateOrganizationCandidateSet", () => {
  it("requires exactly one primary featured organization and exactly one rank 1", () => {
    const none = validateOrganizationCandidateSet([
      candidate({ is_primary_featured: false, featured_rank: 2 }),
    ]);
    assert.equal(none.ok, false);
    assert.ok(none.errors.some((error) => /exactly one is_primary_featured/i.test(error)));
    assert.ok(none.errors.some((error) => /exactly one featured_rank = 1/i.test(error)));

    const twoPrimaries = validateOrganizationCandidateSet([
      candidate(),
      candidate({
        organization_candidate_id: "22222222-2222-4222-8222-222222222222",
        normalized_name: "microsoft",
        is_primary_featured: true,
        featured_rank: 2,
        primary_domain_code: "diversified_technology_company",
        secondary_domain_codes: [],
      }),
    ]);
    assert.equal(twoPrimaries.ok, false);
    assert.ok(twoPrimaries.errors.some((error) => /exactly one is_primary_featured/i.test(error)));

    const ok = validateOrganizationCandidateSet([
      candidate(),
      candidate({
        organization_candidate_id: "22222222-2222-4222-8222-222222222222",
        normalized_name: "microsoft",
        is_primary_featured: false,
        featured_rank: 2,
        primary_domain_code: "diversified_technology_company",
        secondary_domain_codes: [],
      }),
    ]);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.errors, []);
  });

  it("allows at most two secondary domains", () => {
    const tooMany = validateOrganizationCandidateSet([
      candidate({
        secondary_domain_codes: [
          "ai_developer_platform_sdk",
          "open_source_ai_ecosystem",
          "cloud_ai_platform",
        ],
      }),
    ]);
    assert.equal(tooMany.ok, false);
    assert.ok(tooMany.errors.some((error) => /at most two secondary/i.test(error)));
  });

  it("rejects a secondary domain that repeats the primary", () => {
    const repeated = validateOrganizationCandidateSet([
      candidate({
        primary_domain_code: "coding_agents_developer_tools",
        secondary_domain_codes: ["coding_agents_developer_tools"],
      }),
    ]);
    assert.equal(repeated.ok, false);
    assert.ok(repeated.errors.some((error) => /must not repeat the primary domain/i.test(error)));
  });

  it("rejects the primary-featured relationship role on a non-primary organization", () => {
    const result = validateOrganizationCandidateSet([
      candidate({ relationship_roles: ["primary_featured_organization"] }),
      candidate({
        organization_candidate_id: "22222222-2222-4222-8222-222222222222",
        normalized_name: "palantir",
        is_primary_featured: false,
        featured_rank: 2,
        primary_domain_code: "database_data_ai_platform",
        secondary_domain_codes: [],
        relationship_roles: ["primary_featured_organization"],
      }),
    ]);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /non-primary organization must not include/i.test(error)));
  });
});

describe("validateAuthoritativeSourceMinimum", () => {
  it("requires one identity/ownership and one implementation technical source, both verified, public, and authoritative", () => {
    const ok = validateAuthoritativeSourceMinimum([
      source({ source_role: "official_homepage" }),
      source({ source_role: "official_documentation" }),
    ]);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.errors, []);

    const missingTechnical = validateAuthoritativeSourceMinimum([
      source({ source_role: "official_about" }),
    ]);
    assert.equal(missingTechnical.ok, false);
    assert.ok(missingTechnical.errors.some((error) => /implementation-specific technical/i.test(error)));

    const unverified = validateAuthoritativeSourceMinimum([
      source({ source_role: "official_homepage", verification_status: "likely" }),
      source({ source_role: "official_documentation", publicly_retrievable: false }),
    ]);
    assert.equal(unverified.ok, false);
    assert.ok(unverified.errors.some((error) => /identity\/ownership/i.test(error)));
    assert.ok(unverified.errors.some((error) => /implementation-specific technical/i.test(error)));
  });

  it("fails when only a social or snippet-like reputable_secondary source is present", () => {
    const socialOnly = validateAuthoritativeSourceMinimum([
      source({
        source_role: "reputable_secondary_context",
        authority_tier: "reputable_secondary",
      }),
    ]);
    assert.equal(socialOnly.ok, false);
    assert.ok(socialOnly.errors.some((error) => /identity\/ownership/i.test(error)));
    assert.ok(socialOnly.errors.some((error) => /implementation-specific technical/i.test(error)));

    const snippetPlusWeak = validateAuthoritativeSourceMinimum([
      source({
        source_role: "conference_primary_material",
        authority_tier: "reputable_secondary",
      }),
      source({
        source_role: "official_homepage",
        authority_tier: "reputable_secondary",
      }),
    ]);
    assert.equal(snippetPlusWeak.ok, false);
  });

  it("accepts a first-party root homepage as technical evidence only when its support claims name an implementation", () => {
    const productHomepage = source({
      source_role: "official_homepage",
      supports: [
        "Research Replay is the self-service platform for extending completed surveys",
      ],
    });
    assert.equal(isImplementationTechnicalSource(productHomepage), true);
    assert.equal(
      validateAuthoritativeSourceMinimum([
        productHomepage,
        source({ source_role: "official_about" }),
      ]).ok,
      true,
    );

    const genericHomepage = source({
      source_role: "official_homepage",
      supports: ["Example Labs is an AI-native company founded in 2024"],
    });
    assert.equal(isImplementationTechnicalSource(genericHomepage), false);
    const genericResult = validateAuthoritativeSourceMinimum([
      genericHomepage,
      source({ source_role: "official_about" }),
    ]);
    assert.equal(genericResult.ok, false);
    assert.ok(
      genericResult.errors.some((error) => /implementation-specific technical/i.test(error)),
    );
  });
});
