/**
 * Stateless pre-research v3 controller.
 *
 * The automatic path deliberately contains no Eve Client, session, stream,
 * reset, cancellation, or Vercel Workflow call. Durable boundaries are the
 * compact Supabase stage ledger and immutable Storage objects.
 */
import { PACKET_SCHEMA_VERSION, PROMPT_BUNDLE_VERSION, TAXONOMY_VERSION } from "../contracts/enums";
import { applyIntent, ApplyIntentError } from "../executor/apply-intent";
import { packetStoragePrefix } from "../agent/lib/artifact-storage";
import { query } from "../agent/lib/postgres";
import { claimStage, PRE_RESEARCH_STAGES, stageWorkerId, type PreResearchStage } from "./stages/ledger";
import { executeClaimedStage, type StageReceipt } from "./stages/stage-runner";

const MODEL_ID = "zai/glm-5.2";
const DEFAULT_VIDEO_LEASE_SECONDS = 10_800;
const DEFAULT_STAGE_LEASE_SECONDS = 360;

export type PipelineMode = "full" | "research-only" | "synthesis-only";
export type RunPreResearchPipelineOptions = {
  videoId?: string;
  runId?: string;
  next?: boolean;
  mode?: PipelineMode;
  approved?: boolean;
  eveUrl?: string; // CLI compatibility only; v3 does not use Eve.
  leaseSeconds?: number;
  deadlineAtMs?: number;
  maxStages?: number;
  workerId?: string;
};

export type PipelineResult = {
  claimed: boolean;
  reason?: string;
  video_id: string | null;
  run_id: string | null;
  phase: string | null;
  research_session_id: null;
  synthesis_session_id: null;
  packet_storage_prefix: string | null;
  stage_receipts?: StageReceipt[];
  apply_status?: string;
  finished?: boolean;
  error?: string;
};

type ClaimResult = {
  claimed: boolean;
  reason?: string;
  video_id?: string;
  run?: { run_id: string; video_id: string; status: string };
};
type RunRow = {
  run_id: string;
  video_id: string;
  status: string;
  packet_storage_prefix: string | null;
  packet_schema_version: string | null;
  transcript_sha256: string;
};

function stageLeaseSeconds(raw = process.env.PRE_RESEARCH_STAGE_LEASE_SECONDS): number {
  if (!raw?.trim()) return process.env.VERCEL ? DEFAULT_STAGE_LEASE_SECONDS : 1_800;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 1_800) {
    throw new Error("PRE_RESEARCH_STAGE_LEASE_SECONDS must be an integer between 30 and 1800");
  }
  return parsed;
}

export function maxStagesPerInvocation(raw = process.env.PRE_RESEARCH_MAX_STAGES_PER_INVOCATION): number {
  if (!raw?.trim()) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new Error("PRE_RESEARCH_MAX_STAGES_PER_INVOCATION must be an integer between 1 and 3");
  }
  return parsed;
}

function retryCooldownMinutes(raw = process.env.PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES): number {
  if (!raw?.trim()) return 10;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) {
    throw new Error("PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES must be an integer between 1 and 60");
  }
  return parsed;
}

async function loadRun(runId: string): Promise<RunRow> {
  const rows = await query<RunRow>(
    `select run_id, video_id, status, packet_storage_prefix, packet_schema_version, transcript_sha256
       from public.research_pre_research_run where run_id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) throw new Error(`RUN_NOT_FOUND: ${runId}`);
  return row;
}

async function loadLiveRunForVideo(videoId: string): Promise<RunRow | null> {
  const rows = await query<RunRow>(
    `select run_id, video_id, status, packet_storage_prefix, packet_schema_version, transcript_sha256
       from public.research_pre_research_run
      where video_id = $1 and status::text = any($2::text[])
      order by created_at desc limit 1`,
    [videoId, ["claimed", "analyzing", "research_complete", "synthesizing", "intent_ready", "review_required", "applying", "applied"]],
  );
  return rows[0] ?? null;
}

async function claimVideo(videoId?: string, leaseSeconds = DEFAULT_VIDEO_LEASE_SECONDS): Promise<ClaimResult> {
  const rows = await query<{ claim: ClaimResult }>(
    `select research_private.claim_pre_research_video($1, $2, $3, $4, $5, $6) as claim`,
    [leaseSeconds, TAXONOMY_VERSION, PROMPT_BUNDLE_VERSION, MODEL_ID, PACKET_SCHEMA_VERSION, videoId ?? null],
  );
  return rows[0]?.claim ?? { claimed: false, reason: "EMPTY_RESULT" };
}

async function summarizeRun(runId: string, receipts: StageReceipt[] = []): Promise<PipelineResult> {
  const run = await loadRun(runId);
  const state = await query<{ pipeline_status: string; pre_research_pipeline_finished: boolean }>(
    `select pipeline_status, pre_research_pipeline_finished
       from public.research_pre_research_video_state where video_id = $1`,
    [run.video_id],
  );
  return {
    claimed: true,
    video_id: run.video_id,
    run_id: run.run_id,
    phase: state[0]?.pipeline_status ?? run.status,
    research_session_id: null,
    synthesis_session_id: null,
    packet_storage_prefix: run.packet_storage_prefix ?? packetStoragePrefix(run.video_id, run.run_id),
    stage_receipts: receipts,
    finished: state[0]?.pre_research_pipeline_finished ?? false,
  };
}

async function markLateReviewRequired(run: RunRow): Promise<void> {
  await query(
    `update public.research_pre_research_run
        set status = 'review_required', updated_at = timezone('utc', now())
      where run_id = $1 and status::text = any($2::text[])`,
    [run.run_id, ["intent_ready", "applying"]],
  );
  await query(`select research_private.project_pre_research_video_state($1, $2, 'review_required')`, [run.video_id, run.run_id]);
}

async function failRunWithDeadLetter(run: RunRow): Promise<boolean> {
  const dead = await query<{ stage: string; last_error_code: string | null; last_error_detail: string | null }>(
    `select stage, last_error_code, last_error_detail
       from public.research_pre_research_stage_execution
      where run_id = $1 and status = 'dead_letter'
      order by updated_at desc limit 1`,
    [run.run_id],
  );
  if (!dead[0]) return false;
  await query(
    `update public.research_pre_research_run
        set status = 'failed',
            error_code = $2,
            error_detail = $3,
            completed_at = coalesce(completed_at, timezone('utc', now())),
            updated_at = timezone('utc', now())
      where run_id = $1 and status::text <> all($4::text[])`,
    [
      run.run_id,
      dead[0].last_error_code ?? "STAGE_DEAD_LETTER",
      `${dead[0].stage}: ${dead[0].last_error_detail ?? "stage retry series exhausted"}`.slice(0, 4000),
      ["applied", "failed", "superseded"],
    ],
  );
  await query(`select research_private.project_pre_research_video_state($1, $2, 'failed')`, [run.video_id, run.run_id]);
  return true;
}

export async function runPreResearchPipeline(options: RunPreResearchPipelineOptions = {}): Promise<PipelineResult> {
  let run: RunRow | null = null;
  if (options.runId) {
    run = await loadRun(options.runId);
  } else {
    const claim = await claimVideo(options.videoId, options.leaseSeconds);
    if (!claim.claimed) {
      if (options.videoId && claim.reason === "VIDEO_ALREADY_CLAIMED_OR_FINISHED") {
        run = await loadLiveRunForVideo(options.videoId);
      }
      if (!run) {
        return {
          claimed: false,
          reason: claim.reason ?? "NO_ELIGIBLE_VIDEO",
          video_id: options.videoId ?? claim.video_id ?? null,
          run_id: null,
          phase: null,
          research_session_id: null,
          synthesis_session_id: null,
          packet_storage_prefix: null,
        };
      }
    } else {
      const runId = claim.run?.run_id;
      if (!runId) throw new Error("CLAIM_RUN_ID_MISSING");
      run = await loadRun(runId);
    }
  }

  if (run.packet_schema_version !== PACKET_SCHEMA_VERSION) {
    throw new Error(`PACKET_SCHEMA_INCOMPATIBLE: ${run.packet_schema_version}`);
  }
  const workerId = options.workerId ?? stageWorkerId();
  const receipts: StageReceipt[] = [];
  const localDrain = options.deadlineAtMs == null;
  // A local controller has no serverless deadline, so finish the claimed video
  // in one serial process. Cron remains deliberately bounded per invocation.
  const maxStages = options.maxStages ?? (
    options.deadlineAtMs == null ? PRE_RESEARCH_STAGES.length : maxStagesPerInvocation()
  );
  for (let index = 0; index < maxStages; index += 1) {
    if (options.deadlineAtMs != null && Date.now() >= options.deadlineAtMs - 5_000) break;
    run = await loadRun(run.run_id);
    if (["intent_ready", "review_required", "applying", "applied", "failed", "superseded"].includes(run.status)) break;
    if (await failRunWithDeadLetter(run)) break;
    if (localDrain) {
      // Production cooldowns provide fairness between videos. A deliberately
      // serial local canary owns one video, so retry its bounded stage series
      // immediately instead of returning and interleaving another video.
      await query(
        `update public.research_pre_research_stage_execution
            set retry_after = timezone('utc', now()), updated_at = timezone('utc', now())
          where run_id = $1 and status = 'retry_wait'`,
        [run.run_id],
      );
    }
    const stageClaim = await claimStage({ runId: run.run_id, workerId, leaseSeconds: stageLeaseSeconds() });
    if (!stageClaim) {
      if (localDrain) {
        const [waiting] = await query<{ unfinished_count: number; next_ready_at: Date | string | null }>(
          `select count(*) filter (where status <> 'completed')::int as unfinished_count,
                  min(case
                    when status = 'leased' then lease_expires_at
                    when status = 'retry_wait' then retry_after
                  end) as next_ready_at
             from public.research_pre_research_stage_execution
            where run_id = $1`,
          [run.run_id],
        );
        if ((waiting?.unfinished_count ?? 0) > 0 && waiting?.next_ready_at) {
          const readyAt = new Date(waiting.next_ready_at).getTime();
          const waitMs = Math.max(1_000, Math.min(30_000, readyAt - Date.now() + 250));
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          index -= 1;
          continue;
        }
      }
      break;
    }
    const receipt = await executeClaimedStage({
      claim: stageClaim,
      workerId,
      deadlineAtMs: options.deadlineAtMs,
      retryCooldownMinutes: retryCooldownMinutes(),
    });
    receipts.push(receipt);
    if (receipt.status === "dead_letter") {
      await failRunWithDeadLetter(await loadRun(run.run_id));
      break;
    }
    if (receipt.status === "retry_wait" && localDrain) {
      index -= 1;
      continue;
    }
    if (receipt.status !== "completed") break;
    if (options.mode === "research-only" && stageClaim.stage === "curriculum") break;
  }

  run = await loadRun(run.run_id);
  const result = await summarizeRun(run.run_id, receipts);
  if (run.status === "review_required") return result;
  if (["intent_ready", "applying", "applied"].includes(run.status)) {
    try {
      const receipt = await applyIntent({
        runId: run.run_id,
        approved: options.approved,
        finalizeOnly: run.status === "applied",
      });
      Object.assign(result, await summarizeRun(run.run_id, receipts));
      result.apply_status = receipt.status;
      result.finished = receipt.finished_marker_written;
    } catch (error) {
      if (error instanceof ApplyIntentError && error.code === "REVIEW_REQUIRED") {
        await markLateReviewRequired(run);
        Object.assign(result, await summarizeRun(run.run_id, receipts));
        result.error = error.message;
        return result;
      }
      result.error = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

/** Legacy operator command compatibility: reconcile registered artifacts into the v3 ledger. */
export async function recoverStaleResearchSession(runId: string): Promise<boolean> {
  await query(`select research_private.reconcile_pre_research_stage_rows($1::uuid)`, [runId]);
  return true;
}

/** Legacy operator command compatibility: reconcile registered artifacts into the v3 ledger. */
export async function recoverStaleSynthesisSession(runId: string): Promise<boolean> {
  await query(`select research_private.reconcile_pre_research_stage_rows($1::uuid)`, [runId]);
  return true;
}

export type { PreResearchStage };
