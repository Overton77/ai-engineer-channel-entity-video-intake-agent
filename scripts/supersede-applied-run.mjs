import { loadEnv } from "./load-env.mjs";

loadEnv();

const runId = process.argv[2];
const reasonIndex = process.argv.indexOf("--reason");
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1]?.trim() : "";
const confirmed = process.argv.includes("--confirm");

if (!runId || !reason) {
  throw new Error(
    "usage: supersede-applied-run <run-id> --reason <audit-reason> [--confirm]",
  );
}

const { getPostgresPool } = await import("../executor/postgres.ts");
const client = await getPostgresPool().connect();

try {
  await client.query("begin");
  const result = await client.query(
    `select r.run_id, r.video_id, r.status::text as run_status,
            r.transcript_sha256, r.prompt_bundle_version,
            i.intent_id, i.status::text as intent_status,
            coalesce(events.event_count, 0)::int as event_count,
            s.latest_run_id, s.pipeline_status,
            s.pre_research_pipeline_finished as finished,
            s.finished_transcript_sha256, s.finished_intent_id,
            v.pre_research_complete
       from public.research_pre_research_run r
       join public.research_ingestion_intent i on i.run_id = r.run_id
       join public.research_pre_research_video_state s on s.video_id = r.video_id
       join public.research_starter_videos v on v.video_id = r.video_id
       left join lateral (
         select count(*) as event_count
           from public.research_ingestion_intent_event e
          where e.intent_id = i.intent_id
       ) events on true
      where r.run_id = $1::uuid
      for update of r, i, s, v`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`RUN_NOT_FOUND: ${runId}`);
  if (row.run_status !== "applied") {
    throw new Error(`RUN_NOT_APPLIED: ${runId} is ${row.run_status}`);
  }
  if (row.intent_status !== "applied" || row.event_count !== 12) {
    throw new Error(
      `RUN_NOT_FULLY_APPLIED: intent=${row.intent_status} events=${row.event_count}`,
    );
  }
  if (row.latest_run_id !== runId || !row.finished || row.pipeline_status !== "finished") {
    throw new Error(
      `RUN_NOT_LATEST_FINISHED: latest=${row.latest_run_id} finished=${row.finished} pipeline=${row.pipeline_status}`,
    );
  }
  if (row.finished_transcript_sha256 !== row.transcript_sha256 || row.finished_intent_id !== row.intent_id) {
    throw new Error("RUN_FINISHED_PROJECTION_MISMATCH");
  }
  const live = await client.query(
    `select run_id, status::text as status
       from public.research_pre_research_run
      where video_id = $1
        and transcript_sha256 = $2
        and run_id <> $3::uuid
        and status::text = any($4::text[])
      for update`,
    [
      row.video_id,
      row.transcript_sha256,
      runId,
      ["queued", "claimed", "analyzing", "research_complete", "synthesizing", "intent_ready", "review_required", "applying", "applied"],
    ],
  );
  if (live.rowCount > 0) {
    throw new Error(`NEWER_LIVE_RUN_EXISTS: ${JSON.stringify(live.rows)}`);
  }

  const audit = {
    run_id: runId,
    video_id: row.video_id,
    prior_run_status: row.run_status,
    prior_intent_status: row.intent_status,
    prior_event_count: row.event_count,
    prior_prompt_bundle_version: row.prompt_bundle_version,
    preserved_packet: true,
    preserved_intent_and_events: true,
    reason,
  };
  if (!confirmed) {
    await client.query("rollback");
    console.log(JSON.stringify({ dry_run: true, would_supersede: true, ...audit }, null, 2));
  } else {
    await client.query(
      `update public.research_pre_research_run
          set status = 'superseded',
              error_code = 'APPLIED_PACKET_SUPERSEDED',
              error_detail = $2,
              updated_at = timezone('utc', now())
        where run_id = $1::uuid`,
      [runId, reason],
    );
    await client.query(
      `update public.research_pre_research_video_state
          set eligibility_status = 'eligible',
              ineligibility_reasons = '{}',
              pipeline_status = 'superseded',
              pre_research_pipeline_finished = false,
              pre_research_pipeline_finished_at = null,
              finished_transcript_sha256 = null,
              finished_intent_id = null,
              updated_at = timezone('utc', now())
        where video_id = $1`,
      [row.video_id],
    );
    await client.query(
      `update public.research_starter_videos
          set pre_research_complete = false
        where video_id = $1`,
      [row.video_id],
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
