// Tests for: organization-invariants — primary/rank, secondary domains, and source minimum
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
  type AuthoritativeSourceInput,
  type OrganizationCandidateInput,
} from "../contracts/organization-invariants";

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
});
