import { loadEnv } from "./load-env.mjs";

loadEnv();

const runId = process.argv[2];
const reasonIndex = process.argv.indexOf("--reason");
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1]?.trim() : "";
const confirmed = process.argv.includes("--confirm");

if (!runId || !reason) {
  throw new Error(
    "usage: supersede-review-run <run-id> --reason <audit-reason> [--confirm]",
  );
}

const { getPostgresPool } = await import("../executor/postgres.ts");
const client = await getPostgresPool().connect();

try {
  await client.query("begin");
  const runResult = await client.query(
    `select r.run_id, r.video_id, r.status::text as status,
            r.transcript_sha256, r.prompt_bundle_version,
            s.latest_run_id, s.pipeline_status,
            coalesce(s.pre_research_pipeline_finished, false) as finished
       from public.research_pre_research_run r
       join public.research_pre_research_video_state s on s.video_id = r.video_id
      where r.run_id = $1::uuid
      for update of r, s`,
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
  if (run.latest_run_id !== runId || run.pipeline_status !== "review_required") {
    throw new Error(
      `RUN_NOT_LATEST_REVIEW: latest=${run.latest_run_id} pipeline=${run.pipeline_status}`,
    );
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

  const liveResult = await client.query(
    `select run_id, status::text as status
       from public.research_pre_research_run
      where video_id = $1
        and transcript_sha256 = $2
        and run_id <> $3::uuid
        and status::text = any($4::text[])
      for update`,
    [
      run.video_id,
      run.transcript_sha256,
      runId,
      ["queued", "claimed", "analyzing", "research_complete", "synthesizing", "intent_ready", "review_required", "applying", "applied"],
    ],
  );
  if (liveResult.rowCount > 0) {
    throw new Error(`NEWER_LIVE_RUN_EXISTS: ${JSON.stringify(liveResult.rows)}`);
  }

  const audit = {
    run_id: runId,
    video_id: run.video_id,
    prior_run_status: run.status,
    prior_intent_status: intent.status,
    prior_event_count: eventResult.rows[0]?.event_count,
    prior_prompt_bundle_version: run.prompt_bundle_version,
    preserved_packet: true,
    preserved_unapplied_intent: true,
    reason,
  };
  if (!confirmed) {
    await client.query("rollback");
    console.log(JSON.stringify({ dry_run: true, would_supersede: true, ...audit }, null, 2));
    process.exitCode = 0;
  } else {

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
    console.log(JSON.stringify({ superseded: true, reopened_for_reprocessing: true, ...audit }, null, 2));
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}
