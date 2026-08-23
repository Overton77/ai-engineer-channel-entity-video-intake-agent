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
  initial_summary: z.string().min(200).max(1200),
  structured_summary: z.string().min(400).max(4000),
  key_takeaways: z.array(z.string().min(1)).min(5).max(10),
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
    previous = rollingTranscriptSummarySchema.parse(candidate);
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
  const value = {
    schema_version: PACKET_SCHEMA_VERSION,
    run_id: input.runId,
    video_id: input.videoId,
    transcript_sha256: input.transcriptSha256,
    research_as_of: input.researchAsOf,
    ...input.summary,
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
