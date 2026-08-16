import type { ArtifactSandbox } from "./artifact-storage";
import { query } from "./postgres";

export type PreResearchRun = {
  run_id: string;
  video_id: string;
  status: string;
  transcript_sha256: string;
  research_session_id: string | null;
  synthesis_session_id: string | null;
  packet_schema_version: string | null;
  research_as_of: Date | string | null;
  intent_path: string | null;
  intent_sha256: string | null;
  packet_storage_prefix: string | null;
  packet_sha256: string | null;
};

export function asIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function loadPreResearchRun(runId: string): Promise<PreResearchRun> {
  const rows = await query<PreResearchRun>(
    `select
       run_id,
       video_id,
       status,
       transcript_sha256,
       research_session_id,
       synthesis_session_id,
       packet_schema_version,
       research_as_of,
       intent_path,
       intent_sha256,
       packet_storage_prefix,
       packet_sha256
     from public.research_pre_research_run
     where run_id = $1`,
    [runId],
  );
  const run = rows[0];
  if (!run) {
    throw new Error(`RUN_NOT_FOUND: ${runId}`);
  }
  return run;
}

export function assertRunMatchesPacket(
  run: PreResearchRun,
  identity: { run_id: string; video_id: string; transcript_sha256: string },
): void {
  if (run.run_id !== identity.run_id) {
    throw new Error("RUN_MISMATCH: packet run_id does not match loaded run");
  }
  if (run.video_id !== identity.video_id) {
    throw new Error("VIDEO_MISMATCH: packet video_id does not match the run");
  }
  if (run.transcript_sha256 !== identity.transcript_sha256) {
    throw new Error("TRANSCRIPT_HASH_MISMATCH: packet transcript_sha256 does not match the run");
  }
}

export function assertResearchPhaseAccess(run: PreResearchRun, sessionId: string): void {
  if (run.status !== "claimed" && run.status !== "analyzing") {
    throw new Error(
      `ILLEGAL_PHASE: save_research_phase_packet requires claimed|analyzing, got ${run.status}`,
    );
  }
  if (run.research_session_id && run.research_session_id !== sessionId) {
    throw new Error("SESSION_MISMATCH: research_session_id is bound to a different session");
  }
}

export function assertSynthesisPhaseAccess(run: PreResearchRun, sessionId: string): void {
  if (run.status !== "synthesizing") {
    throw new Error(
      `ILLEGAL_PHASE: save_pre_research_packet requires synthesizing, got ${run.status}`,
    );
  }
  if (!run.synthesis_session_id) {
    throw new Error(`SESSION_BINDING_PENDING: synthesis_session_id is not bound for run ${run.run_id}`);
  }
  if (run.synthesis_session_id !== sessionId) {
    throw new Error("SESSION_MISMATCH: synthesis_session_id is bound to a different session");
  }
}

export function assertLoadResearchPhaseAccess(run: PreResearchRun, sessionId: string): void {
  if (run.status !== "research_complete" && run.status !== "synthesizing") {
    throw new Error(
      `ILLEGAL_PHASE: load_research_phase_packet requires research_complete|synthesizing, got ${run.status}`,
    );
  }
  if (run.status === "synthesizing" && run.synthesis_session_id && run.synthesis_session_id !== sessionId) {
    throw new Error("SESSION_MISMATCH: synthesis_session_id is bound to a different session");
  }
}

export async function optionalSandbox(ctx: {
  getSandbox(): PromiseLike<ArtifactSandbox>;
}): Promise<ArtifactSandbox | null> {
  try {
    return await ctx.getSandbox();
  } catch {
    return null;
  }
}
