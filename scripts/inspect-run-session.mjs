import { loadEnv } from "./load-env.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId) throw new Error("usage: inspect-run-session <run-id>");
const { query } = await import("../executor/postgres.ts");
const rows = await query(
  `select video_id, status, research_session_id, synthesis_session_id,
          (select jsonb_build_object('phase', s.phase, 'attempt', s.attempt, 'status', s.status, 'eve_session_id', s.eve_session_id)
             from public.research_pre_research_session s
            where s.run_id = r.run_id order by s.started_at desc limit 1) latest_session,
          (select count(*)::int from public.research_pre_research_artifact a where a.run_id = r.run_id) artifact_count
     from public.research_pre_research_run r where run_id = $1`,
  [runId],
);
console.log(JSON.stringify(rows, null, 2));
