import { loadEnv } from "./load-env.mjs";

loadEnv();

const runId = process.argv[2];
const reasonIndex = process.argv.indexOf("--reason");
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1]?.trim() : "";
const confirmed = process.argv.includes("--confirm");

if (!runId || !reason || !confirmed) {
  throw new Error(
    "usage: supersede-review-run <run-id> --reason <audit-reason> --confirm",
  );
}

const { getPostgresPool } = await import("../executor/postgres.ts");
const client = await getPostgresPool().connect();

try {
  await client.query("begin");
  const runResult = await client.query(
    `select r.run_id, r.video_id, r.status::text as status,
            coalesce(s.pre_research_pipeline_finished, false) as finished
       from public.research_pre_research_run r
       left join public.research_pre_research_video_state s on s.video_id = r.video_id
      where r.run_id = $1::uuid
      for update of r`,
    [runId],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error(`RUN_NOT_FOUND: ${runId}`);
  if (run.status !== "review_required") {
    throw new Error(`RUN_NOT_REVIEW_REQUIRED: ${runId} is ${run.status}`);
  }
  if (run.finished) {
    throw new Error(`RUN_ALREADY_FINISHED: ${runId}`);
  }

  const intentResult = await client.query(
    `select intent_id, status::text as status
       from public.research_ingestion_intent
      where run_id = $1::uuid
      for update`,
    [runId],
  );
  const intent = intentResult.rows[0];
  if (!intent || intent.status !== "validated") {
    throw new Error(
      `INTENT_NOT_UNAPPLIED_VALIDATED: ${runId} is ${intent?.status ?? "missing"}`,
    );
  }

  const eventResult = await client.query(
    `select count(*)::int as event_count
       from public.research_ingestion_intent_event
      where intent_id = $1::uuid`,
    [intent.intent_id],
  );
  if (eventResult.rows[0]?.event_count !== 0) {
    throw new Error(
      `INTENT_HAS_APPLY_EVENTS: ${runId} has ${eventResult.rows[0]?.event_count}`,
    );
  }

  await client.query(
    `update public.research_ingestion_intent
        set status = 'rejected',
            rejected_at = timezone('utc', now()),
            error_detail = $2
      where run_id = $1::uuid`,
    [runId, reason],
  );
  await client.query(
    `update public.research_pre_research_run
        set status = 'superseded',
            error_code = 'REVIEW_PACKET_SUPERSEDED',
            error_detail = $2,
            completed_at = coalesce(completed_at, timezone('utc', now())),
            updated_at = timezone('utc', now())
      where run_id = $1::uuid`,
    [runId, reason],
  );

  await client.query("commit");
  console.log(JSON.stringify({
    superseded: true,
    run_id: runId,
    video_id: run.video_id,
    prior_run_status: run.status,
    prior_intent_status: intent.status,
    preserved_packet: true,
    reason,
  }, null, 2));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}
