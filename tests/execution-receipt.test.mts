// Tests for: execution-receipt — v2 required fields and v1-shaped parse compatibility
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executionReceiptSchema,
  parseExecutionReceipt,
} from "../contracts/execution-receipt";

const INTENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ANALYSIS_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const HASH = "cd".repeat(32);

const baseReceipt = {
  intent_id: INTENT_ID,
  run_id: RUN_ID,
  video_id: "TRjq7t2Ms5I",
  intent_sha256: HASH,
  status: "applied" as const,
  applied_at: "2026-08-16T18:00:00.000Z",
  analysis_id: ANALYSIS_ID,
  operations: [],
  error_code: null,
  error_detail: null,
};

describe("executionReceiptSchema", () => {
  it("parses a v2 receipt with packet_schema_version, packet_storage_prefix, finished_marker_written, and artifact_count", () => {
    const receipt = {
      ...baseReceipt,
      schema_version: "2.0.0",
      packet_schema_version: "2.0.0",
      packet_storage_prefix: "pre-research/v2/TRjq7t2Ms5I/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      finished_marker_written: true,
      artifact_count: 12,
    };
    const parsed = parseExecutionReceipt(receipt);
    assert.equal(parsed.schema_version, "2.0.0");
    assert.equal("packet_schema_version" in parsed && parsed.packet_schema_version, "2.0.0");
    assert.equal(
      "packet_storage_prefix" in parsed && parsed.packet_storage_prefix,
      receipt.packet_storage_prefix,
    );
    assert.equal("finished_marker_written" in parsed && parsed.finished_marker_written, true);
    assert.equal("artifact_count" in parsed && parsed.artifact_count, 12);
    assert.deepEqual(executionReceiptSchema.parse(receipt), parsed);
  });
});

describe("parseExecutionReceipt", () => {
  it("still accepts a v1-shaped receipt", () => {
    const parsed = parseExecutionReceipt({
      ...baseReceipt,
      schema_version: "1.0.0",
    });
    assert.equal(parsed.schema_version, "1.0.0");
    assert.equal("packet_schema_version" in parsed, false);
    assert.equal("finished_marker_written" in parsed, false);
  });
});
