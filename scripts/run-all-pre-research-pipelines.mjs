import { loadEnv } from "./load-env.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

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
const { PROMPT_BUNDLE_VERSION } = await import("../contracts/enums.ts");
const { listEligibleVideos, listRecoverableRuns } = await import("./eligible-videos.mjs");
const { isRetryableTranscriptError } = await import("../agent/lib/video-context.ts");

const startedAt = new Date().toISOString();
const boundaryRequestPath = resolve("outputs/local-drain/stop-after-result.json");
const completed = [];
const deferredReview = [];
const deferredFailed = [];
let exhausted = false;
let transientRetryCount = 0;

async function consumeBoundaryStopRequest(result) {
  let request;
  try {
    request = JSON.parse(await readFile(boundaryRequestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
  if (request.worker_pid !== process.pid
    || request.video_id !== result.video_id
    || request.run_id !== result.run_id) return false;
  await unlink(boundaryRequestPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return true;
}

async function parkTransientRetry(error, context = {}) {
  if (!isRetryableTranscriptError(error)) return false;
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
      ...context,
    }),
  );
  await delay(transientRetryDelaySeconds * 1000);
  return true;
}

// Resume every live packet-v2 run, including work started by the immediately
// preceding deployment. Prompt-version filtering here can strand an in-flight
// leased run whenever source is upgraded during a multi-day drain.
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
  const nextVideo = recovery ? null : (await listEligibleVideos({
    limit: 1,
    excludeFailedPromptBundleVersion: PROMPT_BUNDLE_VERSION,
  }))[0] ?? null;
  let result;
  try {
    result = recovery || nextVideo
      ? await runPreResearchPipeline({
          ...(recovery ? { runId: recovery.run_id } : { videoId: nextVideo.video_id }),
          approved,
          eveUrl,
        })
      : {
          claimed: false,
          reason: "NO_ELIGIBLE_VIDEO",
          video_id: null,
          run_id: null,
          phase: null,
          research_session_id: null,
          synthesis_session_id: null,
          packet_storage_prefix: null,
        };
  } catch (error) {
    if (await parkTransientRetry(error)) continue;
    throw error;
  }
  console.log(JSON.stringify({ event: "video_result", index: completed.length + 1, result }));
  const stopAtBoundary = await consumeBoundaryStopRequest(result);

  if (!result.claimed) {
    if (result.reason === "NO_ELIGIBLE_VIDEO") {
      exhausted = true;
      break;
    }
    console.error(JSON.stringify({ event: "batch_failed", reason: result.reason, result }));
    process.exitCode = 1;
    break;
  }

  if (
    result.error
    && await parkTransientRetry(new Error(result.error), {
      video_id: result.video_id,
      run_id: result.run_id,
      phase: result.phase,
    })
  ) {
    continue;
  }

  completed.push({
    video_id: result.video_id,
    run_id: result.run_id,
    phase: result.phase,
    finished: result.finished ?? false,
    apply_status: result.apply_status ?? null,
  });

  if (result.phase === "review_required") {
    deferredReview.push({
      video_id: result.video_id,
      run_id: result.run_id,
      reason: result.error ?? "review_required",
    });
    console.log(JSON.stringify({ event: "video_deferred_for_review", ...deferredReview.at(-1) }));
    if (stopAtBoundary) {
      console.log(JSON.stringify({ event: "boundary_stop_acknowledged", video_id: result.video_id, run_id: result.run_id }));
      process.exitCode = 75;
      break;
    }
    continue;
  }

  if (result.phase === "failed") {
    deferredFailed.push({
      video_id: result.video_id,
      run_id: result.run_id,
      reason: result.error ?? "bounded stage retry series exhausted",
    });
    console.error(JSON.stringify({ event: "video_deferred_after_failure", ...deferredFailed.at(-1) }));
    continue;
  }

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

  if (stopAtBoundary) {
    console.log(JSON.stringify({ event: "boundary_stop_acknowledged", video_id: result.video_id, run_id: result.run_id }));
    process.exitCode = 75;
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
      deferred_review_count: deferredReview.length,
      deferred_review: deferredReview,
      deferred_failed_count: deferredFailed.length,
      deferred_failed: deferredFailed,
      completed,
    },
    null,
    2,
  ),
);
