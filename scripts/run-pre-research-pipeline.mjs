import { loadEnv } from "./load-env.mjs";

loadEnv();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const videoId = arg("--video-id");
const runId = arg("--run-id");
const researchOnly = process.argv.includes("--research-only");
const synthesisOnly = process.argv.includes("--synthesis-only");
const runNext = process.argv.includes("--next") || (!videoId && !runId && !synthesisOnly);
const approved = process.argv.includes("--approved");
const eveUrl = arg("--eve-url");

if (researchOnly && synthesisOnly) {
  console.error("Use only one of --research-only or --synthesis-only");
  process.exit(2);
}
if (synthesisOnly && !runId) {
  console.error("--synthesis-only requires --run-id");
  process.exit(2);
}

const { runPreResearchPipeline } = await import("../controller/pre-research-pipeline.ts");

const result = await runPreResearchPipeline({
  videoId: videoId || undefined,
  runId: runId || undefined,
  next: runNext,
  mode: researchOnly ? "research-only" : synthesisOnly ? "synthesis-only" : "full",
  approved,
  eveUrl,
});

console.log(JSON.stringify(result, null, 2));

if (!result.claimed && result.reason) {
  process.exit(result.reason === "NO_ELIGIBLE_VIDEO" ? 0 : 1);
}
if (result.error || result.phase === "failed") {
  process.exit(1);
}
