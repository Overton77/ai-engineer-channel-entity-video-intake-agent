import { createHash } from "node:crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { query } from "../lib/postgres";

type VideoRow = {
  video_id: string;
  title: string;
  description: string | null;
  published_at: Date | string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  url: string | null;
  transcript_status: string;
  transcript_bucket: string | null;
  transcript_path: string | null;
  transcript_language: string | null;
  transcript_char_count: number | null;
  transcript_text: string | null;
};

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export default defineTool({
  description:
    "Load one research_starter_videos row by video_id, including transcript text, storage pointer, and SHA-256. Use after claim_pre_research_video. Do not write this transcript into intent files.",
  inputSchema: z.object({
    video_id: z.string().min(1),
  }),
  async execute({ video_id }) {
    const rows = await query<VideoRow>(
      `select
         video_id, title, description, published_at, channel_title, duration_seconds, url,
         transcript_status, transcript_bucket, transcript_path, transcript_language,
         transcript_char_count, transcript_text
       from public.research_starter_videos
       where video_id = $1`,
      [video_id],
    );
    const row = rows[0];
    if (!row) return { found: false as const, video: null };

    const transcript = row.transcript_text ?? "";
    const transcript_sha256 = createHash("sha256").update(transcript, "utf8").digest("hex");

    return {
      found: true as const,
      video: {
        video_id: row.video_id,
        title: row.title,
        description: row.description,
        published_at: toIso(row.published_at),
        channel_title: row.channel_title,
        duration_seconds: row.duration_seconds,
        url: row.url,
        transcript_status: row.transcript_status,
        transcript_bucket: row.transcript_bucket,
        transcript_path: row.transcript_path,
        transcript_language: row.transcript_language,
        transcript_char_count: row.transcript_char_count ?? transcript.length,
        transcript_sha256,
        transcript_text: transcript,
      },
    };
  },
});
