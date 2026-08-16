// Tests for: ingestion-intent — unknown kinds, allowlist order, and idempotency stability
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeIntentIdempotencyKey,
  parseIngestionIntent,
} from "../contracts/ingestion-intent";

const INTENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH = "ab".repeat(32);

function v2Intent(operations: unknown[]) {
  return {
    schema_version: "2.0.0",
    intent_id: INTENT_ID,
    idempotency_key: HASH,
    source: {
      video_id: "TRjq7t2Ms5I",
      run_id: RUN_ID,
      transcript_sha256: HASH,
      taxonomy_version: "1.0.0",
      prompt_bundle_version: "pre-research-2.0.0",
      model_id: "zai/glm-5.2",
      research_as_of: "2026-08-16",
      packet_schema_version: "2.0.0",
    },
    evidence_grades_used: ["said_in_transcript"],
    operations,
  };
}

const domainOp = {
  kind: "replace_domain_assignments",
  payload: [{ domain_code: "software_engineering", confidence: 0.8, rationale: "core topic" }],
};

const lifecycleOp = {
  kind: "replace_lifecycle_assignments",
  payload: ["implementation"],
};

describe("parseIngestionIntent", () => {
  it("rejects unknown operation kinds", () => {
    assert.throws(
      () =>
        parseIngestionIntent(
          v2Intent([
            {
              kind: "execute_sql",
              payload: { sql: "select 1" },
            },
          ]),
        ),
    );
  });

  it("rejects v2 operations that are out of allowlist order", () => {
    assert.throws(() => parseIngestionIntent(v2Intent([lifecycleOp, domainOp])));
    const parsed = parseIngestionIntent(v2Intent([domainOp, lifecycleOp]));
    assert.equal(parsed.schema_version, "2.0.0");
    assert.deepEqual(
      parsed.operations.map((operation) => operation.kind),
      ["replace_domain_assignments", "replace_lifecycle_assignments"],
    );
  });
});

describe("computeIntentIdempotencyKey", () => {
  it("is stable when object keys are reordered", () => {
    const left = computeIntentIdempotencyKey({
      schema_version: "2.0.0",
      source: { video_id: "abc", run_id: RUN_ID, extra: { z: 1, a: 2 } },
      evidence_grades_used: ["said_in_transcript", "verified_external"],
      operations: [{ kind: "replace_lifecycle_assignments", payload: ["research"] }],
    });
    const right = computeIntentIdempotencyKey({
      operations: [{ payload: ["research"], kind: "replace_lifecycle_assignments" }],
      evidence_grades_used: ["said_in_transcript", "verified_external"],
      source: { extra: { a: 2, z: 1 }, run_id: RUN_ID, video_id: "abc" },
      schema_version: "2.0.0",
    });
    assert.equal(left, right);
    assert.match(left, /^[0-9a-f]{64}$/);
  });
});
