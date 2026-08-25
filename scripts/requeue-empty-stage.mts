import { loadEnv } from "./load-env.mjs";

loadEnv();

const [runId, stage] = process.argv.slice(2);
if (!runId || !stage || !process.argv.includes("--confirm")) {
  console.error("usage: requeue-empty-stage <run-id> <stage> --confirm");
  process.exit(2);
}

const { query } = await import("../agent/lib/postgres.ts");
const rows = await query<{ run_id: string; stage: string; status: string }>(
  `update public.research_pre_research_stage_execution e
      set status = 'pending', attempt_count = 0, retry_after = null,
          last_error_code = null, last_error_detail = null,
          updated_at = timezone('utc', now())
    where e.run_id = $1::uuid
      and e.stage = $2
      and e.status = 'dead_letter'
      and not exists (
        select 1 from public.research_pre_research_artifact a
         where a.run_id = e.run_id
           and a.artifact_kind = any(e.output_artifact_kinds)
      )
    returning e.run_id, e.stage, e.status`,
  [runId, stage],
);
if (rows.length !== 1) {
  throw new Error("EMPTY_DEAD_LETTER_STAGE_NOT_FOUND: refusing to requeue a non-empty or non-dead-letter stage");
}
console.log(JSON.stringify(rows[0], null, 2));
