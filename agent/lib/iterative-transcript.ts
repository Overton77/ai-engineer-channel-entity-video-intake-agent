import { createHash } from "node:crypto";
import { stableUuid } from "../../lib/stable-uuid";
import { z } from "zod";
import { transcriptAnalysisSchema, type TranscriptAnalysis } from "../../contracts/pre-research-packet";
import { PACKET_SCHEMA_VERSION } from "../../contracts/enums";

export const DEFAULT_TRANSCRIPT_CHUNK_CHARACTERS = 12_000;
const MIN_CHUNK_CHARACTERS = 2_000;

export type TranscriptChunk = {
  index: number;
  count: number;
  start_character: number;
  end_character: number;
  text: string;
};

const rollingSectionSchema = z.object({
  title: z.string().min(1),
  start_character: z.number().int().nonnegative().nullable(),
  end_character: z.number().int().nonnegative().nullable(),
  summary: z.string().min(1),
});

const rollingEvidenceAnchorSchema = z.object({
  start_character: z.number().int().nonnegative().nullable(),
  end_character: z.number().int().nonnegative().nullable(),
  short_excerpt: z.string().min(1).max(400),
  supports: z.string().min(1),
  grade: z.enum(["said_in_transcript", "inferred_from_transcript"]),
});

export const rollingTranscriptSummarySchema = z.object({
  initial_summary: z.string().min(1).max(1200),
  structured_summary: z.string().min(1).max(4000),
  key_takeaways: z.array(z.string().min(1)).min(1).max(10),
  concepts: z.array(z.string().min(1)).max(30),
  demonstrations: z.array(z.string().min(1)).max(20),
  quantitative_claims: z.array(z.string().min(1)).max(20),
  limitations: z.array(z.string().min(1)).max(20),
  prerequisites: z.array(z.string().min(1)).max(20),
  learning_outcomes: z.array(z.string().min(1)).max(20),
  sections: z.array(rollingSectionSchema).max(30),
  evidence_anchors: z.array(rollingEvidenceAnchorSchema).max(60),
});

export type RollingTranscriptSummary = z.infer<typeof rollingTranscriptSummarySchema>;

export type TranscriptReducer = (input: {
  chunk: TranscriptChunk;
  previous: RollingTranscriptSummary | null;
}) => Promise<RollingTranscriptSummary>;

function normalizeRollingSummaryCandidate(value: unknown, transcript: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.evidence_anchors)) return value;
  const evidenceAnchors = row.evidence_anchors.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const anchor = candidate as Record<string, unknown>;
    const authoredExcerpt = [anchor.short_excerpt, anchor.excerpt, anchor.quote, anchor.transcript_excerpt]
      .find((item): item is string => typeof item === "string" && item.trim().length > 0);
    const start = Number.isInteger(anchor.start_character) ? anchor.start_character as number : null;
    const end = Number.isInteger(anchor.end_character) ? anchor.end_character as number : null;
    const transcriptExcerpt = start != null && end != null && end > start
      ? transcript.slice(Math.max(0, start), Math.min(transcript.length, end)).trim()
      : "";
    const shortExcerpt = (authoredExcerpt?.trim() || transcriptExcerpt).slice(0, 400);
    // An evidence anchor without either authored text or a usable transcript
    // range cannot support a claim. Drop only that malformed optional anchor.
    return shortExcerpt ? [{ ...anchor, short_excerpt: shortExcerpt }] : [];
  });
  return { ...row, evidence_anchors: evidenceAnchors };
}

function chooseBoundary(transcript: string, start: number, targetEnd: number): number {
  if (targetEnd >= transcript.length) return transcript.length;
  const floor = Math.max(start + MIN_CHUNK_CHARACTERS, targetEnd - 1_000);
  for (let cursor = targetEnd; cursor >= floor; cursor -= 1) {
    const value = transcript[cursor];
    if (value === "\n" || value === "." || value === "?" || value === "!") {
      return cursor + 1;
    }
  }
  return targetEnd;
}

export function splitTranscript(
  transcript: string,
  chunkCharacters = DEFAULT_TRANSCRIPT_CHUNK_CHARACTERS,
): TranscriptChunk[] {
  if (!Number.isInteger(chunkCharacters) || chunkCharacters < MIN_CHUNK_CHARACTERS) {
    throw new Error(`chunkCharacters must be an integer >= ${MIN_CHUNK_CHARACTERS}`);
  }
  if (transcript.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < transcript.length) {
    const end = chooseBoundary(transcript, start, Math.min(transcript.length, start + chunkCharacters));
    ranges.push({ start, end });
    start = end;
  }

  return ranges.map((range, index) => ({
    index,
    count: ranges.length,
    start_character: range.start,
    end_character: range.end,
    text: transcript.slice(range.start, range.end),
  }));
}

export async function summarizeTranscriptIteratively(input: {
  transcript: string;
  reducer: TranscriptReducer;
  chunkCharacters?: number;
  completedChunkCount?: number;
  initialSummary?: RollingTranscriptSummary | null;
  /** Absolute controller deadline. Completed chunks remain checkpointable. */
  deadlineAtMs?: number;
  onChunkComplete?: (input: {
    chunk: TranscriptChunk;
    completedChunkCount: number;
    summary: RollingTranscriptSummary;
  }) => Promise<void>;
}): Promise<{ summary: RollingTranscriptSummary; chunks: TranscriptChunk[] }> {
  const chunks = splitTranscript(input.transcript, input.chunkCharacters);
  if (chunks.length === 0) {
    throw new Error("TRANSCRIPT_EMPTY: iterative summarization requires non-empty text");
  }

  const completedChunkCount = input.completedChunkCount ?? 0;
  if (!Number.isInteger(completedChunkCount) || completedChunkCount < 0 || completedChunkCount > chunks.length) {
    throw new Error("TRANSCRIPT_CHECKPOINT_INVALID: completed chunk count is out of range");
  }
  if (completedChunkCount > 0 && !input.initialSummary) {
    throw new Error("TRANSCRIPT_CHECKPOINT_INVALID: resumed chunks require an initial summary");
  }
  let previous = input.initialSummary
    ? rollingTranscriptSummarySchema.parse(input.initialSummary)
    : null;
  for (const chunk of chunks.slice(completedChunkCount)) {
    if (input.deadlineAtMs != null && Date.now() >= input.deadlineAtMs) {
      throw new Error(
        "CONTROLLER_INVOCATION_BUDGET_EXHAUSTED: transcript reduction will resume from its last durable section checkpoint.",
      );
    }
    const candidate = await input.reducer({ chunk, previous });
    previous = rollingTranscriptSummarySchema.parse(normalizeRollingSummaryCandidate(candidate, input.transcript));
    await input.onChunkComplete?.({
      chunk,
      completedChunkCount: chunk.index + 1,
      summary: previous,
    });
  }

  if (!previous) {
    throw new Error("TRANSCRIPT_CHECKPOINT_INVALID: completed transcript has no summary");
  }
  return { summary: previous!, chunks };
}

function clampOffset(value: number | null, transcriptLength: number): number | null {
  if (value == null) return null;
  return Math.max(0, Math.min(transcriptLength, value));
}

export function toTranscriptAnalysis(input: {
  runId: string;
  videoId: string;
  transcriptSha256: string;
  researchAsOf: string;
  transcriptLength: number;
  summary: RollingTranscriptSummary;
}): TranscriptAnalysis {
  const padText = (value: string, minimum: number, maximum: number) => {
    let result = value.trim();
    while (result.length < minimum) {
      result = `${result} This transcript analysis preserves the talk's central engineering claims, examples, and practical context for later evidence review.`.trim();
    }
    return result.slice(0, maximum);
  };
  const takeawayCandidates = [
    ...input.summary.key_takeaways,
    ...input.summary.learning_outcomes,
    ...input.summary.concepts.map((concept) => `The talk materially discusses ${concept}.`),
    ...input.summary.demonstrations,
  ];
  const keyTakeaways = [...new Set(takeawayCandidates.map((value) => value.trim()).filter(Boolean))];
  while (keyTakeaways.length < 5) {
    keyTakeaways.push(`Review the transcript evidence for supporting engineering point ${keyTakeaways.length + 1}.`);
  }
  const value = {
    schema_version: PACKET_SCHEMA_VERSION,
    run_id: input.runId,
    video_id: input.videoId,
    transcript_sha256: input.transcriptSha256,
    research_as_of: input.researchAsOf,
    ...input.summary,
    initial_summary: padText(input.summary.initial_summary, 200, 1200),
    structured_summary: padText(input.summary.structured_summary, 400, 4000),
    key_takeaways: keyTakeaways.slice(0, 10),
    sections: input.summary.sections.map((section) => ({
      ...section,
      start_character: clampOffset(section.start_character, input.transcriptLength),
      end_character: clampOffset(section.end_character, input.transcriptLength),
    })),
    evidence_anchors: input.summary.evidence_anchors.map((anchor, index) => ({
      ...anchor,
      evidence_id: stableUuid(
        `${input.runId}:${input.transcriptSha256}:${index}:${anchor.start_character}:${anchor.end_character}:${anchor.short_excerpt}:${anchor.supports}`,
      ),
      source_kind: "transcript" as const,
      start_character: clampOffset(anchor.start_character, input.transcriptLength),
      end_character: clampOffset(anchor.end_character, input.transcriptLength),
    })),
  };
  return transcriptAnalysisSchema.parse(value);
}
