import { loadEnv } from "./load-env.mjs";

loadEnv();

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const [runId, stage] = process.argv.slice(2);
const expectedOwner = option("--expected-owner");
const deadWorkerPid = Number(option("--dead-worker-pid"));
const confirm = process.argv.includes("--confirm");
if (!runId || !stage || !expectedOwner || !Number.isInteger(deadWorkerPid) || deadWorkerPid <= 0) {
  console.error("usage: release-orphaned-empty-stage <run-id> <stage> --expected-owner <owner> --dead-worker-pid <pid> [--confirm]");
  process.exit(2);
}

try {
  process.kill(deadWorkerPid, 0);
  throw new Error(`DEAD_WORKER_STILL_RUNNING: ${deadWorkerPid}`);
} catch (error: any) {
  if (error?.code !== "ESRCH") throw error;
}

const { query } = await import("../agent/lib/postgres.ts");
const guard = `e.run_id = $1::uuid
      and e.stage = $2::text
      and e.status = 'leased'
      and e.lease_owner = $3::text
      and e.lease_expires_at > timezone('utc', now())
      and e.input_manifest_bucket is null
      and e.input_manifest_path is null
      and e.input_sha256 is null
      and e.completed_artifact_sha256s = '{}'::jsonb
      and e.usage_summary = '{}'::jsonb
      and not exists (
        select 1 from public.research_pre_research_artifact a
         where a.run_id = e.run_id
           and a.artifact_kind = any(e.output_artifact_kinds)
      )
      and not exists (
        select 1 from public.research_ingestion_intent i where i.run_id = e.run_id
      )`;

if (!confirm) {
  const rows = await query<any>(
    `select e.run_id, e.stage, e.status, e.attempt_count, e.lease_owner, e.lease_expires_at,
            e.output_artifact_kinds
       from public.research_pre_research_stage_execution e
      where ${guard}`,
    [runId, stage, expectedOwner],
  );
  if (rows.length !== 1) throw new Error("ORPHANED_EMPTY_STAGE_NOT_FOUND: guards did not match exactly one row");
  console.log(JSON.stringify({ dry_run: true, would_release: true, dead_worker_pid: deadWorkerPid, ...rows[0] }, null, 2));
  process.exit(0);
}

const rows = await query<any>(
  `update public.research_pre_research_stage_execution e
      set status = 'pending',
          attempt_count = greatest(0, e.attempt_count - 1),
          lease_owner = null, lease_token_hash = null, lease_expires_at = null,
          started_at = null, updated_at = timezone('utc', now())
    where ${guard}
    returning e.run_id, e.stage, e.status, e.attempt_count`,
  [runId, stage, expectedOwner],
);
if (rows.length !== 1) throw new Error("ORPHANED_EMPTY_STAGE_NOT_RELEASED: guards changed before confirmation");
console.log(JSON.stringify({ released: true, dead_worker_pid: deadWorkerPid, ...rows[0] }, null, 2));
