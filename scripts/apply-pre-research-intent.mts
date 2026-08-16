import { loadEnv } from "./load-env.mjs";
import { applyIntent, ApplyIntentError } from "../executor/apply-intent";

loadEnv();

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) {
    return fallback;
  }
  return process.argv[idx + 1] ?? fallback;
}

const intentId = arg("--intent-id");
const runId = arg("--run-id");
const finalizeOnly = process.argv.includes("--finalize-only");
const approved = process.argv.includes("--approved");

if (!intentId && !runId) {
  console.error("Usage: npm run apply:intent -- --intent-id <uuid> | --run-id <uuid> [--finalize-only] [--approved]");
  process.exit(2);
}

try {
  const receipt = await applyIntent({ intentId, runId, finalizeOnly, approved });
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status === "rejected") {
    process.exit(2);
  }
  if (!receipt.finished_marker_written) {
    console.error("Intent applied; receipt/finish incomplete. Re-run with --finalize-only.");
    process.exit(3);
  }
} catch (error) {
  const payload = {
    ok: false,
    code: error instanceof ApplyIntentError ? error.code : "APPLY_FAILED",
    error: error instanceof Error ? error.message : String(error),
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(error instanceof ApplyIntentError && error.code === "REVIEW_REQUIRED" ? 2 : 1);
}
