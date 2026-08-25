import { randomUUID } from "node:crypto";
import { query } from "../../agent/lib/postgres";

const PARK_WRITE_ATTEMPTS = 3;
const PARK_WRITE_RETRY_DELAY_MS = 250;

export const PRE_RESEARCH_STAGES = [
  "transcript_taxonomy",
  "web_context",
  "organization_research",
  "source_verification",
  "curriculum",
  "initial_summary",
  "technology_library_summary",
  "organization_profile",
  "ingestion_intent",
] as const;

export type PreResearchStage = (typeof PRE_RESEARCH_STAGES)[number];

export type StageClaim = {
  stage_execution_id: string;
  run_id: string;
  stage: PreResearchStage;
  attempt_count: number;
  lease_token: string;
  lease_expires_at: Date | string;
  output_artifact_kinds: string[];
};

export function stageWorkerId(): string {
  return `${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}:${randomUUID()}`;
}

export async function claimStage(input: {
  runId: string;
  workerId: string;
  leaseSeconds: number;
}): Promise<StageClaim | null> {
  const rows = await query<StageClaim>(
    `select * from research_private.claim_pre_research_stage($1::text, $2::integer, $3::uuid)`,
    [input.workerId, input.leaseSeconds, input.runId],
  );
  return rows[0] ?? null;
}

export async function checkpointStageInput(input: {
  claim: StageClaim;
  workerId: string;
  bucket: string;
  manifestPath: string;
  inputSha256: string;
  promptBundleVersion: string;
}): Promise<void> {
  await query(
    `select research_private.checkpoint_pre_research_stage_input(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text
     )`,
    [
      input.claim.run_id,
      input.claim.stage,
      input.workerId,
      input.claim.lease_token,
      input.bucket,
      input.manifestPath,
      input.inputSha256,
      input.promptBundleVersion,
    ],
  );
}

export async function completeStage(input: {
  claim: StageClaim;
  workerId: string;
  artifactSha256s: Record<string, string>;
  usageSummary: Record<string, unknown>;
  nextStatus?: "intent_ready" | "review_required";
}): Promise<void> {
  await query(
    `select research_private.complete_pre_research_stage(
       $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb, $7::text
     )`,
    [
      input.claim.run_id,
      input.claim.stage,
      input.workerId,
      input.claim.lease_token,
      JSON.stringify(input.artifactSha256s),
      JSON.stringify(input.usageSummary),
      input.nextStatus ?? null,
    ],
  );
}

export async function parkStage(input: {
  claim: StageClaim;
  workerId: string;
  retryable: boolean;
  retryAfter: Date | null;
  errorCode: string;
  errorDetail: string;
}): Promise<void> {
  const expectedStatus = input.retryable ? "retry_wait" : "dead_letter";
  const expectedErrorCode = input.errorCode.slice(0, 120);
  const expectedErrorDetail = input.errorDetail.slice(0, 2_000);
  await settleAmbiguousLedgerWrite({
    write: async () => {
      await query(
        `select research_private.park_pre_research_stage(
           $1::uuid, $2::text, $3::text, $4::text, $5::boolean,
           $6::timestamptz, $7::text, $8::text
         )`,
        [
          input.claim.run_id,
          input.claim.stage,
          input.workerId,
          input.claim.lease_token,
          input.retryable,
          input.retryAfter?.toISOString() ?? null,
          input.errorCode,
          input.errorDetail,
        ],
      );
    },
    verify: async () => {
      const [row] = await query<{
        status: string;
        lease_owner: string | null;
        lease_token_hash: string | null;
        last_error_code: string | null;
        last_error_detail: string | null;
      }>(
        `select status, lease_owner, lease_token_hash, last_error_code, last_error_detail
           from public.research_pre_research_stage_execution
          where run_id = $1::uuid and stage = $2::text`,
        [input.claim.run_id, input.claim.stage],
      );
      return row?.status === expectedStatus
        && row.lease_owner == null
        && row.lease_token_hash == null
        && row.last_error_code === expectedErrorCode
        && row.last_error_detail === expectedErrorDetail;
    },
  });
}

function isTransientLedgerTransportError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|TLS|socket|fetch failed|connection terminated/i.test(message);
}

function isInvalidLeaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /STAGE_LEASE_INVALID/i.test(message);
}

export async function settleAmbiguousLedgerWrite(input: {
  write: () => Promise<void>;
  verify: () => Promise<boolean>;
  attempts?: number;
  retryDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const attempts = input.attempts ?? PARK_WRITE_ATTEMPTS;
  const retryDelayMs = input.retryDelayMs ?? PARK_WRITE_RETRY_DELAY_MS;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await input.write();
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientLedgerTransportError(error) && !isInvalidLeaseError(error)) throw error;
      try {
        if (await input.verify()) return;
      } catch (verificationError) {
        if (!isTransientLedgerTransportError(verificationError)) throw verificationError;
        lastError = verificationError;
      }
      if (attempt < attempts) await wait(retryDelayMs * attempt);
    }
  }

  throw lastError;
}
