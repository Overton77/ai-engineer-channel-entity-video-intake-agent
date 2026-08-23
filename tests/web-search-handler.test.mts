import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PoolClient } from "pg";

import { applyOperation, type HandlerContext } from "../executor/handlers";

describe("record_web_search_events handler", () => {
  it("casts run_id to uuid in the insert projection", async () => {
    const statements: string[] = [];
    const client = {
      async query(text: string) {
        statements.push(text);
        return { rows: [] };
      },
    } as unknown as PoolClient;
    const context: HandlerContext = {
      client,
      runId: "11111111-1111-4111-8111-111111111111",
      videoId: "video-id",
      analysisId: "22222222-2222-4222-8222-222222222222",
      researchAsOf: "2026-08-22",
      videoPublishedAt: "2026-07-28T00:00:00Z",
    };

    await applyOperation(context, {
      kind: "record_web_search_events",
      payload: [{
        subagent: "web_context_scout",
        query: "forward deployed engineering",
        provider: "exa",
        searched_at: "2026-08-22T00:00:00Z",
        result_urls: ["https://example.com/result"],
        selected_urls: ["https://example.com/result"],
        search_purpose: "Verify context",
      }],
    });

    assert.equal(statements.length, 1);
    assert.match(statements[0], /select \$1::uuid, \$2/);
  });

  it("casts run_id to uuid in the live stage recorder projection", () => {
    const source = readFileSync(
      new URL("../agent/tools/record_web_search_event.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /select \$1::uuid, \$2, \$3, 'exa'/);
  });
});
