import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import {
  goldenPacketDirectory,
  loadGoldenPacketCases,
  loadPacketDirectory,
} from "../evals/lib/packet-evaluation";

describe("golden packet evaluation data", () => {
  it("has unique case, video, and run identities", async () => {
    const rows = await loadGoldenPacketCases();
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    assert.equal(new Set(rows.map((row) => `${row.video_id}:${row.run_id}`)).size, rows.length);
    assert.ok(rows.some((row) => row.expected.disposition === "review_required"));
    assert.ok(rows.some((row) => row.expected.primary_category === "retrieval_search_knowledge"));
  });

  it("loads and schema-validates a materialized production packet", async (t) => {
    const row = (await loadGoldenPacketCases()).find(
      (candidate) => candidate.id === "llamaindex-retrieval-platform",
    )!;
    const directory = goldenPacketDirectory(row);
    if (!existsSync(directory)) return t.skip(`missing optional production fixture ${directory}`);
    const { packet } = await loadPacketDirectory(directory);
    assert.equal(packet.run_manifest.run_id, row.run_id);
    assert.equal(packet.run_manifest.video_id, row.video_id);
    assert.equal(packet.ingestion_intent.operations.length, 12);
  });
});
