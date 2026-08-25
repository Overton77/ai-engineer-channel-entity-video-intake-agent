import { loadEnv } from "./load-env.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId) throw new Error("usage: inspect-run-session <run-id>");
const summaryOnly = process.argv.includes("--summary");
const { query } = await import("../executor/postgres.ts");
const rows = await query(
  `select video_id, status, r.error_code, r.error_detail,
          research_session_id, synthesis_session_id,
          (select jsonb_build_object(
                    'phase', s.phase,
                    'attempt', s.attempt,
                    'status', s.status,
                    'eve_session_id', s.eve_session_id,
                    'result_summary', s.result_summary,
                    'error_code', s.error_code,
                    'error_detail', s.error_detail
                  )
             from public.research_pre_research_session s
            where s.run_id = r.run_id order by s.started_at desc limit 1) latest_session,
          (select count(*)::int from public.research_pre_research_artifact a where a.run_id = r.run_id) artifact_count
          ,(select jsonb_build_object(
                    'status', i.status,
                    'error_detail', i.error_detail,
                    'applied_at', i.applied_at
                  )
              from public.research_ingestion_intent i
             where i.run_id = r.run_id) intent_ledger
          ,(select coalesce(jsonb_object_agg(q.subagent, q.event_count), '{}'::jsonb)
              from (
                select e.subagent, count(*)::int as event_count
                  from public.research_web_search_event e
                 where e.run_id = r.run_id
                 group by e.subagent
              ) q) web_search_counts
          ,(select coalesce(jsonb_agg(jsonb_build_object(
                    'stage', e.stage,
                    'status', e.status,
                    'attempt_count', e.attempt_count,
                    'retry_after', e.retry_after,
                    'lease_owner', e.lease_owner,
                    'lease_expires_at', e.lease_expires_at,
                    'input_manifest_bucket', e.input_manifest_bucket,
                    'input_manifest_path', e.input_manifest_path,
                    'input_sha256', e.input_sha256,
                    'output_artifact_kinds', e.output_artifact_kinds,
                    'completed_artifact_sha256s', e.completed_artifact_sha256s,
                    'model_id', e.model_id,
                    'prompt_bundle_version', e.prompt_bundle_version,
                    'usage_summary', e.usage_summary,
                    'last_error_code', e.last_error_code,
                    'last_error_detail', e.last_error_detail,
                    'updated_at', e.updated_at,
                    'completed_at', e.completed_at
                  ) order by array_position(array[
                    'transcript_taxonomy','web_context','organization_research','source_verification',
                    'curriculum','initial_summary','technology_library_summary','organization_profile',
                    'ingestion_intent'
                  ], e.stage)), '[]'::jsonb)
              from public.research_pre_research_stage_execution e
             where e.run_id = r.run_id) stage_executions
     from public.research_pre_research_run r where run_id = $1`,
  [runId],
);
const output = summaryOnly
  ? rows.map((row) => ({
      video_id: row.video_id,
      status: row.status,
      error_code: row.error_code,
      error_detail: row.error_detail,
      artifact_count: row.artifact_count,
      intent_ledger: row.intent_ledger,
      web_search_counts: row.web_search_counts,
      stages: (row.stage_executions ?? []).map((stage) => ({
        stage: stage.stage,
        status: stage.status,
        attempt_count: stage.attempt_count,
        prompt_bundle_version: stage.prompt_bundle_version,
        updated_at: stage.updated_at,
        lease_owner: stage.lease_owner,
        lease_expires_at: stage.lease_expires_at,
        retry_after: stage.retry_after,
        last_error_code: stage.last_error_code,
        last_error_detail: stage.last_error_detail,
        usage_summary: stage.usage_summary,
      })),
    }))
  : rows;

console.log(JSON.stringify(output, null, 2));
