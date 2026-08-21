import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  splitTranscript,
  summarizeTranscriptIteratively,
  toTranscriptAnalysis,
  type RollingTranscriptSummary,
} from "../agent/lib/iterative-transcript";
import { isRetryableTranscriptError } from "../agent/lib/video-context";

function summary(marker: string): RollingTranscriptSummary {
  return {
    initial_summary: `${marker} ${"A compact transcript-only summary. ".repeat(8)}`.slice(0, 400),
    structured_summary: `${marker} ${"A detailed cumulative account of the talk and its supported claims. ".repeat(12)}`.slice(0, 900),
    key_takeaways: ["one", "two", "three", "four", "five"],
    concepts: ["agents"],
    demonstrations: [],
    quantitative_claims: [],
    limitations: [],
    prerequisites: [],
    learning_outcomes: [],
    sections: [],
    evidence_anchors: [],
  };
}

describe("iterative transcript summarization", () => {
  it("retries transient Gateway transport and TLS-edge failures", () => {
    assert.equal(isRetryableTranscriptError(new Error("read ECONNRESET")), true);
    assert.equal(isRetryableTranscriptError(new Error("certificate has expired")), true);
    assert.equal(isRetryableTranscriptError(new Error("TRANSCRIPT_HASH_MISMATCH")), false);
  });

  it("splits without losing or duplicating characters", () => {
    const transcript = `${"First sentence. Second sentence!\n".repeat(250)}tail`;
    const chunks = splitTranscript(transcript, 2_000);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.map((chunk) => chunk.text).join(""), transcript);
    assert.equal(chunks[0]?.start_character, 0);
    assert.equal(chunks.at(-1)?.end_character, transcript.length);
    for (let index = 1; index < chunks.length; index += 1) {
      assert.equal(chunks[index]?.start_character, chunks[index - 1]?.end_character);
    }
  });

  it("passes each cumulative result into the next reducer call", async () => {
    const seenPrevious: Array<RollingTranscriptSummary | null> = [];
    const result = await summarizeTranscriptIteratively({
      transcript: "x".repeat(4_500),
      chunkCharacters: 2_000,
      reducer: async ({ chunk, previous }) => {
        seenPrevious.push(previous);
        return summary(`chunk-${chunk.index}`);
      },
    });
    assert.equal(result.chunks.length, 3);
    assert.equal(seenPrevious[0], null);
    assert.equal(seenPrevious[1]?.initial_summary, summary("chunk-0").initial_summary);
    assert.equal(seenPrevious[2]?.initial_summary, summary("chunk-1").initial_summary);
    assert.equal(result.summary.initial_summary, summary("chunk-2").initial_summary);
  });

  it("materializes a valid packet transcript analysis without raw transcript text", () => {
    const analysis = toTranscriptAnalysis({
      runId: "334e0124-0ea3-4800-8c20-7df4728f7e53",
      videoId: "video",
      transcriptSha256: "a".repeat(64),
      researchAsOf: "2026-08-20",
      transcriptLength: 100,
      summary: {
        ...summary("final"),
        evidence_anchors: [
          {
            start_character: 90,
            end_character: 120,
            short_excerpt: "supported excerpt",
            supports: "a supported claim",
            grade: "said_in_transcript",
          },
        ],
      },
    });
    assert.equal(analysis.evidence_anchors[0]?.end_character, 100);
    assert.equal("transcript_text" in analysis, false);
    assert.match(analysis.evidence_anchors[0]?.evidence_id ?? "", /^[0-9a-f-]{36}$/);
    const repeated = toTranscriptAnalysis({
      runId: "334e0124-0ea3-4800-8c20-7df4728f7e53",
      videoId: "video",
      transcriptSha256: "a".repeat(64),
      researchAsOf: "2026-08-20",
      transcriptLength: 100,
      summary: {
        ...summary("final"),
        evidence_anchors: [
          {
            start_character: 90,
            end_character: 120,
            short_excerpt: "supported excerpt",
            supports: "a supported claim",
            grade: "said_in_transcript",
          },
        ],
      },
    });
    assert.equal(repeated.evidence_anchors[0]?.evidence_id, analysis.evidence_anchors[0]?.evidence_id);
  });
});
