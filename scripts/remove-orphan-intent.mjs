import { loadEnv } from "./load-env.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId) throw new Error("usage: remove-orphan-intent <run-id>");
const { query } = await import("../executor/postgres.ts");
const { deleteStorageObject, downloadStorageObject } = await import("../executor/storage.ts");
const { INTENT_BUCKET } = await import("../contracts/enums.ts");
const runs = await query(
  `select video_id from public.research_pre_research_run where run_id = $1`,
  [runId],
);
if (runs.length !== 1) throw new Error(`run not found: ${runId}`);
const registered = await query(
  `select storage_path from public.research_pre_research_artifact
    where run_id = $1 and artifact_kind = 'ingestion_intent'`,
  [runId],
);
if (registered.length > 0) throw new Error("refusing to remove a registered ingestion_intent");
const path = `pre-research/v2/${runs[0].video_id}/${runId}/90-ingestion-intent.json`;
const existing = await downloadStorageObject(INTENT_BUCKET, path);
await deleteStorageObject(INTENT_BUCKET, path);
console.log(JSON.stringify({ removed: true, bucket: INTENT_BUCKET, path, sha256: existing.sha256 }));
