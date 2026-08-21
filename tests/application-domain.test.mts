import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeApplicationDomainAssignments,
  normalizeApplicationDomainCode,
} from "../lib/application-domain";

describe("normalizeApplicationDomainCode", () => {
  it("preserves lookup codes", () => {
    assert.equal(normalizeApplicationDomainCode("finance_trading"), "finance_trading");
  });

  it("maps free-form research labels to database lookup codes", () => {
    assert.equal(
      normalizeApplicationDomainCode("enterprise_genai_deployment"),
      "enterprise_operations",
    );
    assert.equal(
      normalizeApplicationDomainCode("cloud_ai_infrastructure"),
      "developer_platforms",
    );
    assert.equal(normalizeApplicationDomainCode("multimodal_video_search"), "search_and_knowledge");
  });
});

describe("normalizeApplicationDomainAssignments", () => {
  it("deduplicates labels that map to the same lookup code and keeps the strongest", () => {
    const rows = normalizeApplicationDomainAssignments([
      { domain_code: "enterprise_ai", confidence: 0.7, rationale: "business workflows" },
      { domain_code: "business_operations", confidence: 0.9, rationale: "enterprise operations" },
    ]);
    assert.deepEqual(rows, [
      { domain_code: "enterprise_operations", confidence: 0.9, rationale: "enterprise operations" },
    ]);
  });
});
