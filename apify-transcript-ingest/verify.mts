import { createHash } from "node:crypto";
import { loadEnv } from "../scripts/load-env.mjs";
import { query } from "../agent/lib/postgres";
import { downloadObject } from "../agent/lib/supabase-storage";

loadEnv();

const videoIds = process.argv.includes("--video-id")
  ? process.argv.filter((_, i, arr) => arr[i - 1] === "--video-id")
  : ["ju73sWVtvU0", "ZYoZSU58m_Y"];

const rows = await query<{
  video_id: string;
  title: string;
  duration_seconds: number;
  transcript_path: string;
  transcript_text: string;
  transcript_char_count: number;
}>(
  `select video_id, title, duration_seconds, transcript_path, transcript_text, transcript_char_count
     from public.research_starter_videos
    where video_id = any($1::text[])`,
  [videoIds],
);

const reports = [];
for (const row of rows) {
  const objectText = await downloadObject({
    bucket: "ai-engineer-transcripts",
    path: row.transcript_path,
  });
  const dbSha = createHash("sha256").update(row.transcript_text).digest("hex");
  const objectSha = createHash("sha256").update(objectText).digest("hex");
  const words = row.transcript_text.split(/\s+/).filter(Boolean).length;
  reports.push({
    video_id: row.video_id,
    title: row.title,
    duration_seconds: row.duration_seconds,
    db_chars: row.transcript_text.length,
    stored_char_count: row.transcript_char_count,
    object_chars: objectText.length,
    sha_matches: dbSha === objectSha,
    char_count_matches: row.transcript_char_count === row.transcript_text.length,
    words,
    words_per_min: Number(((words / row.duration_seconds) * 60).toFixed(1)),
    starts_with_music: row.transcript_text.startsWith("[Music]"),
    ends_with_applause: /\[Applause\]|\[Music\]\s*$/.test(row.transcript_text),
    mid_excerpt: row.transcript_text.slice(Math.floor(row.transcript_text.length / 2), Math.floor(row.transcript_text.length / 2) + 280),
  });
}

console.log(JSON.stringify({ ok: reports.every((r) => r.sha_matches && r.char_count_matches), reports }, null, 2));
