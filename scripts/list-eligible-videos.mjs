import { loadEnv } from "./load-env.mjs";
import { listEligibleVideos, listRecoverableRuns } from "./eligible-videos.mjs";

loadEnv();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const limit = Number(arg("--limit", "50"));
const includeApplied = process.argv.includes("--include-applied");
const videoId = arg("--video-id") ?? null;
const summaryOnly = process.argv.includes("--summary");
const rows = await listEligibleVideos({
  limit: Number.isFinite(limit) ? limit : 50,
  includeApplied,
  videoId,
});
const recoverable = await listRecoverableRuns();
const first = rows.find((row) => !row.has_live_or_applied_run) ?? rows[0] ?? null;

console.log(
  JSON.stringify(
    {
      count: rows.length,
      first_unprocessed: first
        ? {
            video_id: first.video_id,
            title: first.title,
            published_at: first.published_at,
            duration_seconds: first.duration_seconds,
            transcript_sha256: first.transcript_sha256,
            ineligibility_reasons: first.ineligibility_reasons,
            pipeline_status: first.pipeline_status,
          }
        : null,
      recoverable_count: recoverable.length,
      recoverable_runs: recoverable,
      ...(summaryOnly ? {} : { videos: rows }),
    },
    null,
    2,
  ),
);
