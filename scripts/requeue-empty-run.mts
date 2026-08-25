import { loadEnv } from "./load-env.mjs";

loadEnv();

const [runId, promptBundleVersion] = process.argv.slice(2);
if (!runId || !promptBundleVersion || !process.argv.includes("--confirm")) {
  console.error("usage: requeue-empty-run <run-id> <prompt-bundle-version> --confirm");
  process.exit(2);
}

const { query } = await import("../agent/lib/postgres.ts");
const rows = await query<{ run_id: string; video_id: string; status: string; reset_stage_count: number }>(
  `with eligible as materialized (
     select r.run_id, r.video_id
       from public.research_pre_research_run r
      where r.run_id = $1::uuid
        and r.status = 'failed'
        and not exists (
          select 1 from public.research_pre_research_artifact a where a.run_id = r.run_id
        )
        and not exists (
          select 1 from public.research_ingestion_intent i where i.run_id = r.run_id
        )
      for update
   ), reset_stages as (
     update public.research_pre_research_stage_execution e
        set status = 'pending', attempt_count = 0,
            lease_owner = null, lease_token_hash = null, lease_expires_at = null,
            retry_after = null, started_at = null, completed_at = null,
            input_manifest_bucket = null, input_manifest_path = null, input_sha256 = null,
            completed_artifact_sha256s = '{}'::jsonb, usage_summary = '{}'::jsonb,
            prompt_bundle_version = $2,
            last_error_code = null, last_error_detail = null,
            updated_at = timezone('utc', now())
       from eligible x
      where e.run_id = x.run_id
      returning e.run_id
   ), reset_run as (
     update public.research_pre_research_run r
        set status = 'claimed', prompt_bundle_version = $2,
            error_code = null, error_detail = null,
            research_completed_at = null, synthesis_started_at = null, completed_at = null,
            updated_at = timezone('utc', now())
       from eligible x
      where r.run_id = x.run_id
      returning r.run_id, r.video_id, r.status::text as status
   ), reset_state as (
     update public.research_pre_research_video_state s
        set latest_run_id = r.run_id, pipeline_status = 'claimed',
            pre_research_pipeline_finished = false,
            pre_research_pipeline_finished_at = null,
            finished_transcript_sha256 = null, finished_intent_id = null,
            updated_at = timezone('utc', now())
       from reset_run r
      where s.video_id = r.video_id
   )
   select r.run_id, r.video_id, r.status,
          (select count(*)::int from reset_stages) as reset_stage_count
     from reset_run r`,
  [runId, promptBundleVersion],
);

if (rows.length !== 1 || rows[0]!.reset_stage_count !== 9) {
  throw new Error("EMPTY_FAILED_RUN_NOT_FOUND: refusing to reset a nonfailed, nonempty, or incomplete stage-ledger run");
}

console.log(JSON.stringify(rows[0], null, 2));
