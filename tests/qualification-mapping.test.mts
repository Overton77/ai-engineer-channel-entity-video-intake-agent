// Tests for: qualification — ineligibility reason mapping and duration eligibility
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDurationEligible, mapIneligibilityReasons } from "../lib/qualification";

describe("mapIneligibilityReasons", () => {
  it("maps transcript storage text failures to TRANSCRIPT_NOT_STORED", () => {
    assert.equal(mapIneligibilityReasons(["transcript_status_not_stored"]), "TRANSCRIPT_NOT_STORED");
    assert.equal(mapIneligibilityReasons(["transcript_text_empty"]), "TRANSCRIPT_NOT_STORED");
  });

  it("maps missing object, path, or bucket failures to TRANSCRIPT_OBJECT_MISSING", () => {
    assert.equal(mapIneligibilityReasons(["transcript_object_missing"]), "TRANSCRIPT_OBJECT_MISSING");
    assert.equal(mapIneligibilityReasons(["path_missing"]), "TRANSCRIPT_OBJECT_MISSING");
    assert.equal(mapIneligibilityReasons(["transcript_path_missing"]), "TRANSCRIPT_OBJECT_MISSING");
    assert.equal(mapIneligibilityReasons(["bucket_invalid"]), "TRANSCRIPT_OBJECT_MISSING");
    assert.equal(mapIneligibilityReasons(["transcript_bucket_invalid"]), "TRANSCRIPT_OBJECT_MISSING");
  });

  it("maps duration_missing to DURATION_MISSING", () => {
    assert.equal(mapIneligibilityReasons(["duration_missing"]), "DURATION_MISSING");
  });

  it("maps duration_non_positive to DURATION_INVALID", () => {
    assert.equal(mapIneligibilityReasons(["duration_non_positive"]), "DURATION_INVALID");
  });

  it("maps duration_at_or_over_5400_seconds to VIDEO_TOO_LONG", () => {
    assert.equal(
      mapIneligibilityReasons(["duration_at_or_over_5400_seconds"]),
      "VIDEO_TOO_LONG",
    );
  });

  it("maps already live or finished reasons to VIDEO_ALREADY_CLAIMED_OR_FINISHED", () => {
    assert.equal(mapIneligibilityReasons(["already_live"]), "VIDEO_ALREADY_CLAIMED_OR_FINISHED");
    assert.equal(mapIneligibilityReasons(["already_finished"]), "VIDEO_ALREADY_CLAIMED_OR_FINISHED");
    assert.equal(
      mapIneligibilityReasons(["already_live_for_current_transcript"]),
      "VIDEO_ALREADY_CLAIMED_OR_FINISHED",
    );
    assert.equal(
      mapIneligibilityReasons(["already_finished_for_current_transcript"]),
      "VIDEO_ALREADY_CLAIMED_OR_FINISHED",
    );
  });
});

describe("isDurationEligible", () => {
  it("treats 5399 as eligible and 5400/5401 as too long", () => {
    assert.deepEqual(isDurationEligible(5399), { ok: true });
    assert.deepEqual(isDurationEligible(5400), { ok: false, reason: "VIDEO_TOO_LONG" });
    assert.deepEqual(isDurationEligible(5401), { ok: false, reason: "VIDEO_TOO_LONG" });
  });
});
