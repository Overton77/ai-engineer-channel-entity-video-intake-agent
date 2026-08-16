/**
 * Durable two-session pre-research controller.
 *
 * Eve already deploys onto Vercel Workflow, so this file is plain TypeScript
 * rather than a second `use workflow` project. Crash safety comes from the
 * claim / begin_* / complete_* phase functions: a retry resumes from the
 * persisted run phase and session IDs instead of starting a third Eve app.
 */
import { Client, ClientError, type MessageResult } from "eve/client";
import {
  PACKET_SCHEMA_VERSION,
  PROMPT_BUNDLE_VERSION,
  TAXONOMY_VERSION,
} from "../contracts/enums";
import { applyIntent, ApplyIntentError, type ApplyIntentOptions } from "../executor/apply-intent";
import {
  RESEARCH_ARTIFACT_KINDS,
  SYNTHESIS_ARTIFACT_KINDS,
  packetStoragePrefix,
  writeHostArtifact,
} from "../executor/artifacts";
import { query } from "../executor/postgres";
import { downloadJsonObject, downloadStorageObject } from "../executor/storage";

const MODEL_ID = "zai/glm-5.2";
const DEFAULT_LEASE_SECONDS = 1800;

export type PipelineMode = "full" | "research-only" | "synthesis-only";

export type RunPreResearchPipelineOptions = {
  videoId?: string;
  runId?: string;
  next?: boolean;
  mode?: PipelineMode;
  approved?: boolean;
  eveUrl?: string;
  leaseSeconds?: number;
};

export type PipelineResult = {
  claimed: boolean;
  reason?: string;
  video_id: string | null;
  run_id: string | null;
  phase: string | null;
  research_session_id: string | null;
  synthesis_session_id: string | null;
  packet_storage_prefix: string | null;
  research_status?: MessageResult["status"];
  synthesis_status?: MessageResult["status"];
  apply_status?: string;
  finished?: boolean;
  error?: string;
};

type ClaimResult = {
  claimed: boolean;
  reason?: string;
  video_id?: string;
  run?: { run_id: string; video_id: string; status: string };
  video?: { video_id: string };
};

type RunRow = {
  run_id: string;
  video_id: string;
  status: string;
  research_session_id: string | null;
  synthesis_session_id: string | null;
  packet_storage_prefix: string | null;
  packet_schema_version: string | null;
  transcript_sha256: string;
};

type SessionRow = {
  eve_session_id: string;
  status: string;
  phase: string;
  attempt: number;
};

function eveHost(explicit?: string): string {
  return (explicit ?? process.env.EVE_URL ?? "http://127.0.0.1:2000").replace(/\/$/, "");
}

export function createPipelineClient(host?: string): Client {
  return new Client({ host: eveHost(host) });
}

export function buildResearchPhaseMessage(runId: string): string {
  return [
    "You are in the RESEARCH phase of a pre-research v2 run.",
    `The controller already claimed the video. Use run_id ${runId}.`,
    "Do not call claim_pre_research_video.",
    "Do not write 60, 70, 80, or 90 artifacts.",
    "Do not start synthesis or mark the pipeline finished.",
    "Load the claimed run, reconfirm qualification, write and save the 00-50 research checkpoint, then stop.",
  ].join(" ");
}

export function buildSynthesisPhaseMessage(runId: string): string {
  return [
    "You are in the SYNTHESIS phase of a pre-research v2 run.",
    `Research is complete. Use run_id ${runId}.`,
    "Do not call claim_pre_research_video.",
    "Do not call research subagents.",
    "Load the verified 00-50 packet, produce 60, 70, 80, and 90, save the completed packet, then stop.",
    "Do not mark the pipeline finished.",
  ].join(" ");
}

function isBindingPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SESSION_BINDING_PENDING");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBindingRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isBindingPending(error) || attempt === attempts - 1) {
        throw error;
      }
      await sleep(200 * (attempt + 1));
    }
  }
  throw lastError;
}

async function loadRun(runId: string): Promise<RunRow> {
  const rows = await query<RunRow>(
    `select run_id, video_id, status, research_session_id, synthesis_session_id,
            packet_storage_prefix, packet_schema_version, transcript_sha256
       from public.research_pre_research_run
      where run_id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`RUN_NOT_FOUND: ${runId}`);
  }
  return row;
}

async function loadLiveRunForVideo(videoId: string): Promise<RunRow | null> {
  const rows = await query<RunRow>(
    `select run_id, video_id, status, research_session_id, synthesis_session_id,
            packet_storage_prefix, packet_schema_version, transcript_sha256
       from public.research_pre_research_run
      where video_id = $1
        and status in (
          'claimed', 'analyzing', 'research_complete', 'synthesizing',
          'intent_ready', 'review_required', 'applying', 'applied'
        )
      order by created_at desc
      limit 1`,
    [videoId],
  );
  return rows[0] ?? null;
}

async function latestSession(runId: string, phase: "research" | "synthesis"): Promise<SessionRow | null> {
  const rows = await query<SessionRow>(
    `select eve_session_id, status, phase, attempt
       from public.research_pre_research_session
      where run_id = $1 and phase = $2
      order by attempt desc
      limit 1`,
    [runId, phase],
  );
  return rows[0] ?? null;
}

async function markSessionFailed(
  runId: string,
  sessionId: string,
  code: string,
  detail: string,
): Promise<void> {
  await query(
    `update public.research_pre_research_session
        set status = 'failed',
            completed_at = timezone('utc', now()),
            error_code = $3,
            error_detail = $4
      where run_id = $1
        and eve_session_id = $2
        and status = 'started'`,
    [runId, sessionId, code, detail],
  );
}

async function revertFailedSynthesis(runId: string): Promise<void> {
  await query(
    `update public.research_pre_research_run
        set status = 'research_complete',
            synthesis_session_id = null
      where run_id = $1
        and status = 'synthesizing'`,
    [runId],
  );
  const run = await loadRun(runId);
  await query(`select research_private.project_pre_research_video_state($1, $2, 'research_complete')`, [
    run.video_id,
    run.run_id,
  ]);
}

async function claimVideo(videoId?: string, leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<ClaimResult> {
  const rows = await query<{ claim: ClaimResult }>(
    `select research_private.claim_pre_research_video($1, $2, $3, $4, $5, $6) as claim`,
    [leaseSeconds, TAXONOMY_VERSION, PROMPT_BUNDLE_VERSION, MODEL_ID, PACKET_SCHEMA_VERSION, videoId ?? null],
  );
  return rows[0]?.claim ?? { claimed: false, reason: "EMPTY_RESULT" };
}

async function beginResearchSession(runId: string, sessionId: string): Promise<void> {
  await withBindingRetry(async () => {
    await query(`select research_private.begin_research_session($1::uuid, $2)`, [runId, sessionId]);
  });
}

async function completeResearchPhase(runId: string, sessionId: string): Promise<void> {
  await withBindingRetry(async () => {
    await query(`select research_private.complete_research_phase($1::uuid, $2)`, [runId, sessionId]);
  });
}

async function beginSynthesisSession(runId: string, sessionId: string): Promise<void> {
  await withBindingRetry(async () => {
    await query(`select research_private.begin_synthesis_session($1::uuid, $2)`, [runId, sessionId]);
  });
}

async function completeSynthesisPhase(
  runId: string,
  sessionId: string,
  nextStatus: "intent_ready" | "review_required",
): Promise<void> {
  await query(`select research_private.complete_synthesis_phase($1::uuid, $2, $3::public.research_pre_research_run_status)`, [
    runId,
    sessionId,
    nextStatus,
  ]);
}

async function registeredKinds(runId: string, kinds: readonly string[]): Promise<string[]> {
  const rows = await query<{ artifact_kind: string }>(
    `select artifact_kind
       from public.research_pre_research_artifact
      where run_id = $1
        and artifact_kind = any($2::text[])
        and content_sha256 ~ '^[0-9a-f]{64}$'`,
    [runId, [...kinds]],
  );
  return rows.map((row) => row.artifact_kind);
}

function missingKinds(required: readonly string[], present: readonly string[]): string[] {
  const have = new Set(present);
  return required.filter((kind) => !have.has(kind));
}

async function waitForExistingSession(client: Client, sessionId: string): Promise<MessageResult> {
  const session = client.sessions.attach(sessionId);
  let message: string | undefined;
  let status: MessageResult["status"] = "waiting";
  for await (const event of session.stream({ follow: true, startIndex: 0 })) {
    if (event.type === "message.completed") {
      const data = event.data as { message?: string } | undefined;
      if (data?.message) {
        message = data.message;
      }
    }
    if (event.type === "turn.failed" || event.type === "session.failed") {
      status = "failed";
      break;
    }
    if (event.type === "session.completed" || event.type === "turn.completed") {
      status = "completed";
      break;
    }
    if (event.type === "session.waiting") {
      status = "waiting";
      break;
    }
  }
  return {
    data: undefined,
    message,
    events: [],
    inputRequests: [],
    sessionId,
    status,
  };
}

function sessionIsTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

async function runResearchSession(client: Client, run: RunRow): Promise<{
  sessionId: string;
  result: MessageResult;
}> {
  const existing = await latestSession(run.run_id, "research");
  if (existing && existing.status === "started" && run.research_session_id) {
    const result = await waitForExistingSession(client, run.research_session_id);
    return { sessionId: run.research_session_id, result };
  }
  if (existing && sessionIsTerminal(existing.status) && existing.status !== "failed") {
    return {
      sessionId: existing.eve_session_id,
      result: {
        data: undefined,
        message: undefined,
        events: [],
        inputRequests: [],
        sessionId: existing.eve_session_id,
        status: "completed",
      },
    };
  }

  const created = await client.sessions.create({
    message: buildResearchPhaseMessage(run.run_id),
    clientContext: { phase: "research", run_id: run.run_id },
  });
  const sessionId = created.response.sessionId;
  if (!sessionId) {
    throw new Error("SESSION_BINDING_PENDING: research sessionId was empty");
  }
  await beginResearchSession(run.run_id, sessionId);
  const result = await created.response.result();
  return { sessionId, result };
}

async function runSynthesisSession(client: Client, run: RunRow): Promise<{
  sessionId: string;
  result: MessageResult;
}> {
  const existing = await latestSession(run.run_id, "synthesis");
  if (run.status === "synthesizing" && run.synthesis_session_id && existing?.status === "started") {
    const result = await waitForExistingSession(client, run.synthesis_session_id);
    if (result.status === "failed") {
      await markSessionFailed(run.run_id, run.synthesis_session_id, "SYNTHESIS_FAILED", result.message ?? "failed");
      await revertFailedSynthesis(run.run_id);
    } else {
      return { sessionId: run.synthesis_session_id, result };
    }
  } else if (existing && existing.status === "failed") {
    await revertFailedSynthesis(run.run_id);
  } else if (existing && existing.status === "completed" && run.status !== "research_complete") {
    return {
      sessionId: existing.eve_session_id,
      result: {
        data: undefined,
        message: undefined,
        events: [],
        inputRequests: [],
        sessionId: existing.eve_session_id,
        status: "completed",
      },
    };
  }

  const current = await loadRun(run.run_id);
  if (current.status !== "research_complete") {
    throw new Error(`ILLEGAL_PHASE_TRANSITION: synthesis requires research_complete, found ${current.status}`);
  }

  const created = await client.sessions.create({
    message: buildSynthesisPhaseMessage(current.run_id),
    clientContext: { phase: "synthesis", run_id: current.run_id },
  });
  const sessionId = created.response.sessionId;
  if (!sessionId) {
    throw new Error("SESSION_BINDING_PENDING: synthesis sessionId was empty");
  }
  await beginSynthesisSession(current.run_id, sessionId);
  const result = await created.response.result();
  return { sessionId, result };
}

async function materializeRunArtifacts(runId: string): Promise<void> {
  const rows = await query<{ storage_bucket: string; storage_path: string }>(
    `select storage_bucket, storage_path
       from public.research_pre_research_artifact
      where run_id = $1
      order by artifact_kind`,
    [runId],
  );
  for (const row of rows) {
    const downloaded = await downloadStorageObject(row.storage_bucket, row.storage_path);
    await writeHostArtifact(row.storage_path, downloaded.bytes);
  }
}

async function summarizeRun(runId: string): Promise<PipelineResult> {
  const run = await loadRun(runId);
  const state = await query<{
    pipeline_status: string;
    pre_research_pipeline_finished: boolean;
  }>(
    `select pipeline_status, pre_research_pipeline_finished
       from public.research_pre_research_video_state
      where video_id = $1`,
    [run.video_id],
  );
  return {
    claimed: true,
    video_id: run.video_id,
    run_id: run.run_id,
    phase: state[0]?.pipeline_status ?? run.status,
    research_session_id: run.research_session_id,
    synthesis_session_id: run.synthesis_session_id,
    packet_storage_prefix:
      run.packet_storage_prefix ??
      packetStoragePrefix(run.video_id, run.run_id, run.packet_schema_version ?? PACKET_SCHEMA_VERSION),
    finished: state[0]?.pre_research_pipeline_finished ?? false,
  };
}

export async function runPreResearchPipeline(
  options: RunPreResearchPipelineOptions = {},
): Promise<PipelineResult> {
  const mode = options.mode ?? "full";
  const client = createPipelineClient(options.eveUrl);
  try {
    await client.health();
  } catch (error) {
    const host = eveHost(options.eveUrl);
    const detail = error instanceof ClientError ? `${error.status}` : String(error);
    throw new Error(`Eve is not reachable at ${host} (${detail}). Start it with: npm exec -- eve dev --no-ui --port 2000`);
  }

  let run: RunRow | null = null;
  if (options.runId) {
    run = await loadRun(options.runId);
  } else if (mode !== "synthesis-only") {
    const claim = await claimVideo(options.videoId, options.leaseSeconds);
    if (!claim.claimed) {
      if (options.videoId && claim.reason === "VIDEO_ALREADY_CLAIMED_OR_FINISHED") {
        run = await loadLiveRunForVideo(options.videoId);
        if (!run) {
          return {
            claimed: false,
            reason: claim.reason,
            video_id: options.videoId,
            run_id: null,
            phase: null,
            research_session_id: null,
            synthesis_session_id: null,
            packet_storage_prefix: null,
          };
        }
      } else {
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
    } else if (claim.run) {
      run = await loadRun(claim.run.run_id);
    }
  }

  if (!run) {
    return {
      claimed: false,
      reason: "RUN_NOT_FOUND",
      video_id: options.videoId ?? null,
      run_id: options.runId ?? null,
      phase: null,
      research_session_id: null,
      synthesis_session_id: null,
      packet_storage_prefix: null,
    };
  }

  const result = await summarizeRun(run.run_id);
  result.claimed = true;

  const researchNeeded = ["claimed", "analyzing"].includes(run.status);
  if (researchNeeded) {
    const research = await runResearchSession(client, run);
    result.research_session_id = research.sessionId;
    result.research_status = research.result.status;
    if (research.result.status === "failed") {
      await markSessionFailed(run.run_id, research.sessionId, "RESEARCH_FAILED", research.result.message ?? "failed");
      result.phase = "failed";
      result.error = research.result.message ?? "research session failed";
      return result;
    }
    const present = await registeredKinds(run.run_id, RESEARCH_ARTIFACT_KINDS);
    const missing = missingKinds(RESEARCH_ARTIFACT_KINDS, present);
    if (missing.length > 0) {
      result.phase = "researching";
      result.error = `RESEARCH_CHECKPOINT_INCOMPLETE: ${missing.join(",")}`;
      return result;
    }
    await completeResearchPhase(run.run_id, research.sessionId);
    run = await loadRun(run.run_id);
    await materializeRunArtifacts(run.run_id);
    Object.assign(result, await summarizeRun(run.run_id));
  }

  if (mode === "research-only") {
    return result;
  }

  run = await loadRun(run.run_id);
  const synthesisNeeded = run.status === "research_complete" || run.status === "synthesizing";
  if (synthesisNeeded) {
    const synthesis = await runSynthesisSession(client, run);
    result.synthesis_session_id = synthesis.sessionId;
    result.synthesis_status = synthesis.result.status;
    if (synthesis.result.status === "failed") {
      await markSessionFailed(run.run_id, synthesis.sessionId, "SYNTHESIS_FAILED", synthesis.result.message ?? "failed");
      await revertFailedSynthesis(run.run_id);
      result.phase = "research_complete";
      result.error = synthesis.result.message ?? "synthesis session failed";
      return result;
    }
    const present = await registeredKinds(run.run_id, SYNTHESIS_ARTIFACT_KINDS);
    const missing = missingKinds(SYNTHESIS_ARTIFACT_KINDS, present);
    if (missing.length > 0) {
      result.phase = "synthesizing";
      result.error = `SYNTHESIS_PACKET_INCOMPLETE: ${missing.join(",")}`;
      return result;
    }
    run = await loadRun(run.run_id);
    if (run.status === "synthesizing") {
      const nextStatus = await inferSynthesisNextStatus(run.run_id);
      await completeSynthesisPhase(run.run_id, synthesis.sessionId, nextStatus);
      run = await loadRun(run.run_id);
    }
    await materializeRunArtifacts(run.run_id);
    Object.assign(result, await summarizeRun(run.run_id));
  }

  if (mode === "synthesis-only") {
    return result;
  }

  run = await loadRun(run.run_id);
  if (run.status === "review_required") {
    result.phase = "review_required";
    result.error = "Automatic apply refused: run is review_required";
    return result;
  }
  if (run.status === "intent_ready" || run.status === "applying" || run.status === "applied") {
    try {
      const applyOptions: ApplyIntentOptions = {
        runId: run.run_id,
        approved: options.approved,
        finalizeOnly: run.status === "applied",
      };
      const receipt = await applyIntent(applyOptions);
      result.apply_status = receipt.status;
      result.finished = receipt.finished_marker_written;
      await materializeRunArtifacts(run.run_id);
      Object.assign(result, await summarizeRun(run.run_id));
      result.apply_status = receipt.status;
      result.finished = receipt.finished_marker_written;
    } catch (error) {
      if (error instanceof ApplyIntentError && error.code === "REVIEW_REQUIRED") {
        result.phase = "review_required";
        result.error = error.message;
        return result;
      }
      result.error = error instanceof Error ? error.message : String(error);
      Object.assign(result, await summarizeRun(run.run_id), { error: result.error });
    }
  }

  return result;
}

async function inferSynthesisNextStatus(runId: string): Promise<"intent_ready" | "review_required"> {
  const artifacts = await query<{ storage_bucket: string; storage_path: string }>(
    `select storage_bucket, storage_path
       from public.research_pre_research_artifact
      where run_id = $1 and artifact_kind = 'organization_profile'`,
    [runId],
  );
  const artifact = artifacts[0];
  if (!artifact) {
    return "intent_ready";
  }
  try {
    const profile = (await downloadJsonObject(artifact.storage_bucket, artifact.storage_path)).json as {
      review_required?: boolean;
      primary_domain_code?: string;
    };
    if (profile.review_required || profile.primary_domain_code === "other_unknown") {
      return "review_required";
    }
  } catch {
    return "intent_ready";
  }
  return "intent_ready";
}
