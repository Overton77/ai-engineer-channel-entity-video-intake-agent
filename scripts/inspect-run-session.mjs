import { loadEnv } from "./load-env.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId) throw new Error("usage: inspect-run-session <run-id>");
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
     from public.research_pre_research_run r where run_id = $1`,
  [runId],
);
console.log(JSON.stringify(rows, null, 2));
