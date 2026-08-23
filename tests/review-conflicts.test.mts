import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOrganizationHierarchyConflict,
  organizationProfileHasHierarchyConflict,
} from "../contracts/review-policy";

describe("organization review conflict classification", () => {
  it("does not block on a technology-name ambiguity explicitly unrelated to organization identity", () => {
    assert.equal(
      isOrganizationHierarchyConflict(
        "The DeepChem kernel name could not be verified. This does not affect organization identification.",
      ),
      false,
    );
  });

  it("blocks unresolved ownership and parent-company ambiguity", () => {
    assert.equal(
      isOrganizationHierarchyConflict("Unclear whether Example Labs is a subsidiary or its parent organization."),
      true,
    );
  });

  it("does not treat advisory review metadata as a hierarchy conflict", () => {
    assert.equal(
      organizationProfileHasHierarchyConflict({
        review_reasons: [
          "Evidence linkage needs manual confirmation.",
          "Video publication date differs between indexes.",
        ],
        unresolved_conflicts: ["Search index publication timestamp may be crawl time."],
      }),
      false,
    );
  });

  it("blocks hierarchy language even when it appears only in review reasons", () => {
    assert.equal(
      organizationProfileHasHierarchyConflict({
        review_reasons: ["Unclear whether Example is the parent company or a subsidiary."],
        unresolved_conflicts: [],
      }),
      true,
    );
  });

  it("does not block verified post-video ownership changes", () => {
    assert.equal(
      organizationProfileHasHierarchyConflict({
        review_reasons: [
          "Ownership changed since video: Dynatrace announced a definitive agreement to acquire Arize AI.",
        ],
        unresolved_conflicts: [],
      }),
      false,
    );
  });

  it("blocks declarative hierarchy entries in unresolved_conflicts", () => {
    assert.equal(
      organizationProfileHasHierarchyConflict({
        review_reasons: [],
        unresolved_conflicts: ["Ownership of Example Labs is attributed to two parent organizations."],
      }),
      true,
    );
  });
});
