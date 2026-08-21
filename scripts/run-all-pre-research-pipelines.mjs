import { loadEnv } from "./load-env.mjs";
import { setTimeout as delay } from "node:timers/promises";

loadEnv();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const rawMax = arg("--max-videos", "0");
const maxVideos = Number(rawMax);
if (!Number.isInteger(maxVideos) || maxVideos < 0) {
  console.error("--max-videos must be a non-negative integer (0 means drain the backlog)");
  process.exit(2);
}

const approved = process.argv.includes("--approved");
const eveUrl = arg("--eve-url");
const transientRetryDelaySeconds = Number(arg("--transient-retry-delay-seconds", "30"));
const maxTransientRetries = Number(arg("--max-transient-retries", "0"));
if (!Number.isInteger(transientRetryDelaySeconds) || transientRetryDelaySeconds < 1 || transientRetryDelaySeconds > 60) {
  console.error("--transient-retry-delay-seconds must be an integer from 1 to 60");
  process.exit(2);
}
if (!Number.isInteger(maxTransientRetries) || maxTransientRetries < 0) {
  console.error("--max-transient-retries must be a non-negative integer (0 means unlimited)");
  process.exit(2);
}
const { runPreResearchPipeline } = await import("../controller/pre-research-pipeline.ts");
const { listRecoverableRuns } = await import("./eligible-videos.mjs");
const { isRetryableTranscriptError } = await import("../agent/lib/video-context.ts");

const startedAt = new Date().toISOString();
const completed = [];
let exhausted = false;
let transientRetryCount = 0;

const recoverableRuns = await listRecoverableRuns();
console.log(
  JSON.stringify({
    event: "recovery_queue",
    count: recoverableRuns.length,
    runs: recoverableRuns.map(({ run_id, video_id, status, artifact_count }) => ({
      run_id,
      video_id,
      status,
      artifact_count,
    })),
  }),
);

while (maxVideos === 0 || completed.length < maxVideos) {
  const recovery = recoverableRuns.shift();
  let result;
  try {
    result = await runPreResearchPipeline({
      ...(recovery ? { runId: recovery.run_id } : { next: true }),
      approved,
      eveUrl,
    });
  } catch (error) {
    if (!isRetryableTranscriptError(error)) throw error;
    transientRetryCount += 1;
    if (maxTransientRetries > 0 && transientRetryCount > maxTransientRetries) throw error;
    const freshRecoverable = await listRecoverableRuns();
    recoverableRuns.splice(0, recoverableRuns.length, ...freshRecoverable);
    console.error(
      JSON.stringify({
        event: "transient_retry_parked",
        retry: transientRetryCount,
        delay_seconds: transientRetryDelaySeconds,
        recovery_count: freshRecoverable.length,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await delay(transientRetryDelaySeconds * 1000);
    continue;
  }
  console.log(JSON.stringify({ event: "video_result", index: completed.length + 1, result }));

  if (!result.claimed) {
    if (result.reason === "NO_ELIGIBLE_VIDEO") {
      exhausted = true;
      break;
    }
    console.error(JSON.stringify({ event: "batch_failed", reason: result.reason, result }));
    process.exitCode = 1;
    break;
  }

  completed.push({
    video_id: result.video_id,
    run_id: result.run_id,
    phase: result.phase,
    finished: result.finished ?? false,
    apply_status: result.apply_status ?? null,
  });

  if (result.error || !result.finished) {
    console.error(
      JSON.stringify({
        event: "batch_stopped",
        reason: result.error ?? `video did not finish (phase=${result.phase})`,
        video_id: result.video_id,
        run_id: result.run_id,
      }),
    );
    process.exitCode = 1;
    break;
  }
}

console.log(
  JSON.stringify(
    {
      event: "batch_summary",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      processed_count: completed.length,
      exhausted,
      completed,
    },
    null,
    2,
  ),
);
