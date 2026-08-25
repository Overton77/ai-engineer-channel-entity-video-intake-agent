import { PACKET_SCHEMA_VERSION, PROMPT_BUNDLE_VERSION } from "../contracts/enums";
import { getPostgresPool } from "../executor/postgres";
import { runPreResearchPipeline, type PipelineResult } from "./pre-research-pipeline";

const SCHEDULER_LOCK_NAME = "pre-research-v3-stateless-scheduled-dispatch";
const DEFAULT_RETRY_COOLDOWN_MINUTES = 10;
const DEFAULT_INVOCATION_BUDGET_MS = 240_000;

export type ScheduledPreResearchResult =
  | { status: "disabled" | "overlap_skipped" }
  | { status: "completed"; resumed_run_id: string | null; result: PipelineResult };

export function scheduledRetryCooldownMinutes(
  raw = process.env.PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES,
): number {
  if (!raw?.trim()) return DEFAULT_RETRY_COOLDOWN_MINUTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 60) {
    throw new Error(
      "PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES must be an integer between 5 and 60",
    );
  }
  return parsed;
}

export function scheduledInvocationBudgetMs(
  raw = process.env.PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS,
): number {
  if (!raw?.trim()) return DEFAULT_INVOCATION_BUDGET_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 270_000) {
    throw new Error(
      "PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS must be an integer between 60000 and 270000",
    );
  }
  return parsed;
}

async function oldestReadyRecoverableRunId(): Promise<string | null> {
  const { rows } = await getPostgresPool().query<{ run_id: string }>(
    `select r.run_id
       from public.research_pre_research_run r
       join public.research_starter_videos v on v.video_id = r.video_id
       left join public.research_pre_research_video_state s on s.video_id = v.video_id
      where r.packet_schema_version = $1
        and r.status::text = any($2::text[])
        and r.transcript_sha256 = encode(extensions.digest(v.transcript_text, 'sha256'), 'hex')
        and v.transcript_status = 'stored'
        and v.transcript_bucket = 'ai-engineer-transcripts'
        and v.transcript_path is not null
        and v.transcript_text is not null
        and length(btrim(v.transcript_text)) > 0
        and v.duration_seconds > 0
        and v.duration_seconds < 5400
        and exists (
          select 1 from storage.objects o
           where o.bucket_id = v.transcript_bucket and o.name = v.transcript_path
        )
        and not coalesce(s.pre_research_pipeline_finished, false)
        and (
          not exists (
            select 1 from public.research_pre_research_stage_execution e
             where e.run_id = r.run_id
          )
          or exists (
            select 1 from public.research_pre_research_stage_execution e
             where e.run_id = r.run_id
               and (
                 e.status = 'pending'
                 or (e.status = 'retry_wait' and coalesce(e.retry_after, '-infinity') <= now())
                 or (e.status = 'leased' and e.lease_expires_at <= now())
               )
          )
        )
        and coalesce(r.updated_at, r.created_at) <= now() - make_interval(mins => $3::int)
      order by coalesce(r.updated_at, r.created_at) asc, r.created_at asc, r.run_id
      limit 1`,
    [
      PACKET_SCHEMA_VERSION,
      ["queued", "claimed", "analyzing", "research_complete", "synthesizing", "intent_ready", "applying", "applied"],
      scheduledRetryCooldownMinutes(),
    ],
  );
  return rows[0]?.run_id ?? null;
}

async function nextClaimableVideoId(): Promise<string | null> {
  const { rows } = await getPostgresPool().query<{ video_id: string }>(
    `select v.video_id
       from public.research_starter_videos v
       left join public.research_pre_research_video_state s on s.video_id = v.video_id
      where v.transcript_status = 'stored'
        and v.transcript_bucket = 'ai-engineer-transcripts'
        and v.transcript_path is not null
        and v.transcript_text is not null
        and length(btrim(v.transcript_text)) > 0
        and v.duration_seconds > 0
        and v.duration_seconds < 5400
        and exists (
          select 1 from storage.objects o
           where o.bucket_id = v.transcript_bucket and o.name = v.transcript_path
        )
        and not coalesce(s.pre_research_pipeline_finished, false)
        and not exists (
          select 1
            from public.research_pre_research_run r
           where r.video_id = v.video_id
             and r.packet_schema_version = $1
             and r.transcript_sha256 = encode(extensions.digest(v.transcript_text, 'sha256'), 'hex')
             and r.status::text = any($2::text[])
        )
        and not exists (
          select 1
            from public.research_pre_research_run prior
           where prior.video_id = v.video_id
             and prior.packet_schema_version = $1
             and prior.prompt_bundle_version = $3
             and prior.transcript_sha256 = encode(extensions.digest(v.transcript_text, 'sha256'), 'hex')
             and prior.status = 'failed'
        )
      order by v.published_at asc nulls last, v.video_id
      limit 1`,
    [
      PACKET_SCHEMA_VERSION,
      ["queued", "claimed", "analyzing", "research_complete", "synthesizing", "intent_ready", "review_required", "applying", "applied"],
      PROMPT_BUNDLE_VERSION,
    ],
  );
  return rows[0]?.video_id ?? null;
}

/** Runs at most one serial pipeline while holding a project-wide session lock. */
export async function runScheduledPreResearchOnce(): Promise<ScheduledPreResearchResult> {
  if (process.env.PRE_RESEARCH_SCHEDULE_ENABLED !== "true") {
    return { status: "disabled" };
  }

  // Vercel currently caps this Cron function at 300 seconds. Give the
  // controller one absolute deadline covering every stage it starts, leaving
  // a full minute for cleanup, advisory unlock, logging, and runtime jitter.
  const invocationDeadlineAtMs = Date.now() + scheduledInvocationBudgetMs();

  const client = await getPostgresPool().connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      `select pg_try_advisory_lock(hashtext($1::text)) as locked`,
      [SCHEDULER_LOCK_NAME],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return { status: "overlap_skipped" };

    const resumedRunId = await oldestReadyRecoverableRunId();
    const videoId = resumedRunId ? null : await nextClaimableVideoId();
    if (resumedRunId) {
      // The scheduler owns this timestamp as its durable retry/fairness marker.
      // A parked run cools down while another run gets the next serial tick.
      await client.query(
        `update public.research_pre_research_run
            set updated_at = now()
          where run_id = $1`,
        [resumedRunId],
      );
    }
    const result = resumedRunId || videoId
      ? await runPreResearchPipeline({
          ...(resumedRunId ? { runId: resumedRunId } : { videoId: videoId! }),
          deadlineAtMs: invocationDeadlineAtMs,
        })
      : {
          claimed: false,
          reason: "NO_ELIGIBLE_VIDEO",
          video_id: null,
          run_id: null,
          phase: null,
          research_session_id: null,
          synthesis_session_id: null,
          packet_storage_prefix: null,
        };
    return { status: "completed", resumed_run_id: resumedRunId, result };
  } finally {
    if (locked) {
      await client.query(`select pg_advisory_unlock(hashtext($1::text))`, [SCHEDULER_LOCK_NAME]);
    }
    client.release();
  }
}
