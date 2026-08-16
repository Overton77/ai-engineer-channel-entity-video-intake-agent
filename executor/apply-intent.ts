import type { PoolClient } from "pg";
import {
  PACKET_SCHEMA_VERSION,
  V1_INTENT_SCHEMA_VERSION,
  V1_PACKET_SCHEMA_VERSION,
} from "../contracts/enums";
import {
  parseExecutionReceipt,
  type ExecutionReceipt,
  type ParsedExecutionReceipt,
} from "../contracts/execution-receipt";
import {
  computeIntentIdempotencyKey,
  parseIngestionIntent,
  type ParsedIngestionIntent,
} from "../contracts/ingestion-intent";
import {
  validateAuthoritativeSourceMinimum,
  validateOrganizationCandidateSet,
} from "../contracts/organization-invariants";
import { canonicalizeJson } from "../lib/canonical-json";
import { hashCanonicalJson, sha256Hex } from "../lib/hash";
import {
  APPLY_ARTIFACT_KINDS,
  ARTIFACT_FILENAMES,
  artifactStoragePath,
  intentBucket,
  packetStoragePrefix,
  writeHostArtifact,
} from "./artifacts";
import { applyOperation, assertEvidenceIdsExist, referencedEvidenceIds } from "./handlers";
import { tableForOperationKind } from "./operations";
import { clientQuery, query, withTransaction } from "./postgres";
import { downloadJsonObject, downloadStorageObject, uploadStorageObject } from "./storage";

export class ApplyIntentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApplyIntentError";
    this.code = code;
  }
}

export type ApplyIntentOptions = {
  intentId?: string;
  runId?: string;
  finalizeOnly?: boolean;
  approved?: boolean;
};

type IntentLedgerRow = {
  intent_id: string;
  run_id: string;
  video_id: string;
  schema_version: string;
  idempotency_key: string;
  storage_bucket: string;
  storage_path: string;
  content_sha256: string;
  status: string;
  applied_at: Date | string | null;
};

type RunRow = {
  run_id: string;
  video_id: string;
  status: string;
  transcript_sha256: string;
  prompt_bundle_version: string;
  model_id: string;
  intent_path: string | null;
  intent_sha256: string | null;
  packet_schema_version: string | null;
  packet_storage_prefix: string | null;
  research_as_of: Date | string | null;
  taxonomy_version: string;
  taxonomy_status: string;
};

type VideoEligibilityRow = {
  video_id: string;
  transcript_status: string | null;
  transcript_text: string | null;
  transcript_bucket: string | null;
  transcript_path: string | null;
  duration_seconds: number | null;
  published_at: Date | string | null;
  transcript_object_exists: boolean;
};

type ArtifactRow = {
  artifact_kind: string;
  storage_bucket: string;
  storage_path: string;
  content_sha256: string;
  schema_version: string;
};

type IntentEventRow = {
  operation_index: number;
  operation_kind: string;
  status: "applied" | "skipped" | "failed";
  affected_table: string | null;
  affected_key: string | null;
  error_detail: string | null;
};

type ApplyCommitResult = {
  receipt: ExecutionReceipt;
  alreadyApplied: boolean;
  prefix: string;
};

function asIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function asIsoDateTime(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.includes("T") ? value : new Date(value).toISOString();
  }
  return value.toISOString();
}

function normalizePrefix(prefix: string | null | undefined): string {
  return (prefix ?? "").replace(/\/$/, "");
}

function isV2Intent(intent: ParsedIngestionIntent): intent is Extract<
  ParsedIngestionIntent,
  { schema_version: "2.0.0" }
> {
  return intent.schema_version !== V1_INTENT_SCHEMA_VERSION;
}

async function loadIntentRow(options: ApplyIntentOptions): Promise<IntentLedgerRow> {
  if (!options.intentId && !options.runId) {
    throw new ApplyIntentError("INTENT_NOT_FOUND", "Provide --intent-id or --run-id");
  }
  const rows = options.intentId
    ? await query<IntentLedgerRow>(
        `select intent_id, run_id, video_id, schema_version, idempotency_key,
                storage_bucket, storage_path, content_sha256, status, applied_at
           from public.research_ingestion_intent
          where intent_id = $1`,
        [options.intentId],
      )
    : await query<IntentLedgerRow>(
        `select intent_id, run_id, video_id, schema_version, idempotency_key,
                storage_bucket, storage_path, content_sha256, status, applied_at
           from public.research_ingestion_intent
          where run_id = $1`,
        [options.runId],
      );
  const row = rows[0];
  if (!row) {
    throw new ApplyIntentError("INTENT_NOT_FOUND", "No ingestion intent ledger row matches the request");
  }
  return row;
}

async function loadRun(runId: string): Promise<RunRow> {
  const rows = await query<RunRow>(
    `select r.run_id, r.video_id, r.status, r.transcript_sha256, r.prompt_bundle_version,
            r.model_id, r.intent_path, r.intent_sha256, r.packet_schema_version,
            r.packet_storage_prefix, r.research_as_of, tv.version as taxonomy_version,
            tv.status as taxonomy_status
       from public.research_pre_research_run r
       join public.research_taxonomy_version tv
         on tv.taxonomy_version_id = r.taxonomy_version_id
      where r.run_id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) {
    throw new ApplyIntentError("RUN_NOT_FOUND", `Run ${runId} was not found`);
  }
  return row;
}

async function loadVideoEligibility(videoId: string): Promise<VideoEligibilityRow> {
  const rows = await query<VideoEligibilityRow>(
    `select v.video_id, v.transcript_status, v.transcript_text, v.transcript_bucket,
            v.transcript_path, v.duration_seconds, v.published_at,
            exists (
              select 1
                from storage.objects o
               where o.bucket_id = v.transcript_bucket
                 and o.name = v.transcript_path
            ) as transcript_object_exists
       from public.research_starter_videos v
      where v.video_id = $1`,
    [videoId],
  );
  const row = rows[0];
  if (!row) {
    throw new ApplyIntentError("VIDEO_NOT_FOUND", `Video ${videoId} was not found`);
  }
  return row;
}

function assertEligibility(video: VideoEligibilityRow, expectedHash: string): string {
  const reasons: string[] = [];
  if (video.transcript_status !== "stored") {
    reasons.push("transcript_status_not_stored");
  }
  if (!video.transcript_text || video.transcript_text.trim().length === 0) {
    reasons.push("transcript_text_empty");
  }
  if (video.transcript_bucket !== "ai-engineer-transcripts") {
    reasons.push("transcript_bucket_invalid");
  }
  if (!video.transcript_path) {
    reasons.push("transcript_path_missing");
  }
  if (!video.transcript_object_exists) {
    reasons.push("transcript_object_missing");
  }
  if (video.duration_seconds == null) {
    reasons.push("duration_missing");
  } else if (video.duration_seconds <= 0) {
    reasons.push("duration_non_positive");
  } else if (video.duration_seconds >= 5400) {
    reasons.push("duration_at_or_over_5400_seconds");
  }
  const transcriptHash = video.transcript_text ? sha256Hex(video.transcript_text) : "";
  if (reasons.length > 0) {
    throw new ApplyIntentError(
      "VIDEO_INELIGIBLE",
      `Video ${video.video_id} is not eligible: ${reasons.join(", ")}`,
    );
  }
  if (transcriptHash !== expectedHash) {
    throw new ApplyIntentError(
      "TRANSCRIPT_HASH_MISMATCH",
      "Current transcript SHA-256 does not match the run/intent transcript hash",
    );
  }
  return transcriptHash;
}

async function verifyRegisteredArtifacts(input: {
  runId: string;
  prefix: string;
  kinds: readonly string[];
}): Promise<ArtifactRow[]> {
  const rows = await query<ArtifactRow>(
    `select artifact_kind, storage_bucket, storage_path, content_sha256, schema_version
       from public.research_pre_research_artifact
      where run_id = $1
        and artifact_kind = any($2::text[])`,
    [input.runId, [...input.kinds]],
  );
  const byKind = new Map(rows.map((row) => [row.artifact_kind, row]));
  const missing = input.kinds.filter((kind) => !byKind.has(kind));
  if (missing.length > 0) {
    throw new ApplyIntentError(
      "PACKET_INCOMPLETE",
      `Required artifacts are not registered: ${missing.join(", ")}`,
    );
  }
  for (const kind of input.kinds) {
    const row = byKind.get(kind);
    if (!row) {
      continue;
    }
    const expectedPath = artifactStoragePath(input.prefix, kind as keyof typeof ARTIFACT_FILENAMES);
    if (normalizePrefix(row.storage_path) !== normalizePrefix(expectedPath)) {
      throw new ApplyIntentError(
        "ARTIFACT_PATH_MISMATCH",
        `${kind} registry path ${row.storage_path} does not match ${expectedPath}`,
      );
    }
    const downloaded = await downloadStorageObject(row.storage_bucket, row.storage_path);
    if (downloaded.sha256 !== row.content_sha256) {
      throw new ApplyIntentError(
        "ARTIFACT_HASH_MISMATCH",
        `${kind} storage hash ${downloaded.sha256} does not match registry ${row.content_sha256}`,
      );
    }
    await writeHostArtifact(row.storage_path, downloaded.bytes);
  }
  return rows;
}

function reviewRefusalReasons(
  intent: ParsedIngestionIntent,
  run: RunRow,
  profile: {
    review_required?: boolean;
    unresolved_conflicts?: string[];
    primary_domain_code?: string;
    primary_featured_organization?: { primary_domain_code: string } | null;
  } | null,
): string[] {
  const reasons: string[] = [];
  if (run.status === "review_required") {
    reasons.push("run status is review_required");
  }
  if (profile?.review_required) {
    reasons.push("organization profile review_required");
  }
  if ((profile?.unresolved_conflicts ?? []).length > 0) {
    reasons.push("unresolved organization hierarchy conflicts");
  }
  if (!isV2Intent(intent)) {
    return reasons;
  }
  const candidatesOp = intent.operations.find(
    (operation) => operation.kind === "replace_organization_candidates",
  );
  const sourcesOp = intent.operations.find(
    (operation) => operation.kind === "replace_organization_sources",
  );
  const candidates = candidatesOp?.kind === "replace_organization_candidates" ? candidatesOp.payload : [];
  const sources = sourcesOp?.kind === "replace_organization_sources" ? sourcesOp.payload : [];
  if (candidates.length > 0) {
    const setCheck = validateOrganizationCandidateSet(candidates);
    reasons.push(...setCheck.errors);
    const primary = candidates.find((candidate) => candidate.is_primary_featured);
    if (primary?.primary_domain_code === "other_unknown") {
      reasons.push("primary organization domain is other_unknown");
    }
    if (primary && primary.primary_domain_code !== "other_unknown") {
      const sourceCheck = validateAuthoritativeSourceMinimum(
        sources.filter((source) => source.organization_candidate_id === primary.organization_candidate_id),
      );
      reasons.push(...sourceCheck.errors);
    }
  }
  const profileDomain =
    profile?.primary_featured_organization?.primary_domain_code ?? profile?.primary_domain_code;
  if (profileDomain === "other_unknown") {
    reasons.push("organization profile primary_domain_code is other_unknown");
  }
  return [...new Set(reasons)];
}

function buildReceipt(input: {
  intent: ParsedIngestionIntent;
  intentSha256: string;
  status: ExecutionReceipt["status"];
  appliedAt: string | null;
  analysisId: string | null;
  operations: ExecutionReceipt["operations"];
  errorCode: string | null;
  errorDetail: string | null;
  prefix: string;
  finishedMarkerWritten: boolean;
  artifactCount: number;
}): ExecutionReceipt {
  const base = {
    intent_id: input.intent.intent_id,
    run_id: input.intent.source.run_id,
    video_id: input.intent.source.video_id,
    intent_sha256: input.intentSha256,
    status: input.status,
    applied_at: input.appliedAt,
    analysis_id: input.analysisId,
    operations: input.operations,
    error_code: input.errorCode,
    error_detail: input.errorDetail,
  };
  if (!isV2Intent(input.intent)) {
    return {
      schema_version: PACKET_SCHEMA_VERSION,
      packet_schema_version: V1_PACKET_SCHEMA_VERSION,
      packet_storage_prefix: input.prefix,
      finished_marker_written: input.finishedMarkerWritten,
      artifact_count: input.artifactCount,
      ...base,
    };
  }
  return {
    schema_version: PACKET_SCHEMA_VERSION,
    packet_schema_version: input.intent.source.packet_schema_version,
    packet_storage_prefix: input.prefix,
    finished_marker_written: input.finishedMarkerWritten,
    artifact_count: input.artifactCount,
    ...base,
  };
}

async function reconstructAlreadyAppliedReceipt(input: {
  intent: ParsedIngestionIntent;
  ledger: IntentLedgerRow;
  prefix: string;
  artifactCount: number;
}): Promise<ExecutionReceipt> {
  const analysis = await query<{ analysis_id: string }>(
    `select analysis_id from public.research_video_analysis where run_id = $1`,
    [input.ledger.run_id],
  );
  const events = await query<IntentEventRow>(
    `select operation_index, operation_kind as operation_kind, status, affected_table,
            affected_key, error_detail
       from public.research_ingestion_intent_event
      where intent_id = $1
      order by operation_index`,
    [input.ledger.intent_id],
  );
  const operations =
    events.length > 0
      ? events.map((event) => ({
          operation_index: event.operation_index,
          kind: event.operation_kind as ExecutionReceipt["operations"][number]["kind"],
          status: event.status,
          affected_table: event.affected_table,
          affected_key: event.affected_key,
          error_detail: event.error_detail,
        }))
      : input.intent.operations.map((operation, index) => ({
          operation_index: index,
          kind: operation.kind as ExecutionReceipt["operations"][number]["kind"],
          status: "applied" as const,
          affected_table: tableForOperationKind(operation.kind),
          affected_key: analysis[0]?.analysis_id ?? null,
          error_detail: null,
        }));
  return buildReceipt({
    intent: input.intent,
    intentSha256: input.ledger.content_sha256,
    status: "already_applied",
    appliedAt: asIsoDateTime(input.ledger.applied_at),
    analysisId: analysis[0]?.analysis_id ?? null,
    operations,
    errorCode: null,
    errorDetail: null,
    prefix: input.prefix,
    finishedMarkerWritten: false,
    artifactCount: input.artifactCount,
  });
}

async function registerExecutionReceipt(input: {
  runId: string;
  intentId: string;
  prefix: string;
  receipt: ExecutionReceipt;
}): Promise<{ sha256: string; byteCount: number; path: string }> {
  const body = `${canonicalizeJson(input.receipt)}\n`;
  const path = artifactStoragePath(input.prefix, "execution_receipt");
  const uploaded = await uploadStorageObject({
    bucket: intentBucket(),
    path,
    body,
    contentType: "application/json",
    upsert: true,
  });
  const existing = await query<ArtifactRow>(
    `select artifact_kind, storage_bucket, storage_path, content_sha256, schema_version
       from public.research_pre_research_artifact
      where run_id = $1 and artifact_kind = 'execution_receipt'`,
    [input.runId],
  );
  if (existing[0] && existing[0].content_sha256 !== uploaded.sha256) {
    throw new ApplyIntentError(
      "RECEIPT_COLLISION",
      "An execution receipt already exists with a different hash",
    );
  }
  await query(
    `insert into public.research_pre_research_artifact (
       run_id, intent_id, artifact_kind, schema_version, storage_bucket,
       storage_path, content_sha256, byte_count
     ) values ($1, $2, 'execution_receipt', $3, $4, $5, $6, $7)
     on conflict (run_id, artifact_kind) do update
       set content_sha256 = excluded.content_sha256,
           byte_count = excluded.byte_count,
           intent_id = excluded.intent_id
     where public.research_pre_research_artifact.content_sha256 = excluded.content_sha256`,
    [
      input.runId,
      input.intentId,
      input.receipt.schema_version,
      intentBucket(),
      path,
      uploaded.sha256,
      uploaded.byteCount,
    ],
  );
  await writeHostArtifact(path, body);
  return { ...uploaded, path };
}

async function markFinished(input: {
  videoId: string;
  runId: string;
  intentId: string;
  transcriptSha256: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await clientQuery(
      client,
      `insert into public.research_pre_research_video_state (
         video_id, transcript_sha256, eligibility_status, pipeline_status,
         latest_run_id, pre_research_pipeline_finished, pre_research_pipeline_finished_at,
         finished_transcript_sha256, finished_intent_id, evaluated_at
       ) values (
         $1, $2, 'eligible', 'finished', $3, true, timezone('utc', now()), $2, $4, timezone('utc', now())
       )
       on conflict (video_id) do update set
         latest_run_id = excluded.latest_run_id,
         pipeline_status = 'finished',
         pre_research_pipeline_finished = true,
         pre_research_pipeline_finished_at = timezone('utc', now()),
         finished_transcript_sha256 = excluded.finished_transcript_sha256,
         finished_intent_id = excluded.finished_intent_id`,
      [input.videoId, input.transcriptSha256, input.runId, input.intentId],
    );
  });
}

async function markFinalizing(client: PoolClient, videoId: string, runId: string): Promise<void> {
  await clientQuery(
    client,
    `select research_private.project_pre_research_video_state($1, $2, 'finalizing')`,
    [videoId, runId],
  );
}

async function applyInTransaction(input: {
  ledger: IntentLedgerRow;
  run: RunRow;
  intent: ParsedIngestionIntent;
  prefix: string;
  artifactCount: number;
  videoPublishedAt: Date | string | null;
}): Promise<ApplyCommitResult> {
  return withTransaction(async (client) => {
    await clientQuery(client, `select pg_advisory_xact_lock(hashtext($1::text))`, [
      input.ledger.intent_id,
    ]);
    const locked = await clientQuery<IntentLedgerRow>(
      client,
      `select intent_id, run_id, video_id, schema_version, idempotency_key,
              storage_bucket, storage_path, content_sha256, status, applied_at
         from public.research_ingestion_intent
        where intent_id = $1`,
      [input.ledger.intent_id],
    );
    const current = locked[0];
    if (!current) {
      throw new ApplyIntentError("INTENT_NOT_FOUND", "Intent disappeared under advisory lock");
    }
    if (current.status === "applied") {
      return {
        alreadyApplied: true,
        prefix: input.prefix,
        receipt: await reconstructAlreadyAppliedReceipt({
          intent: input.intent,
          ledger: current,
          prefix: input.prefix,
          artifactCount: input.artifactCount,
        }),
      };
    }

    await clientQuery(
      client,
      `update public.research_pre_research_run
          set status = 'applying'
        where run_id = $1`,
      [input.run.run_id],
    );
    await clientQuery(
      client,
      `select research_private.project_pre_research_video_state($1, $2, 'applying')`,
      [input.run.video_id, input.run.run_id],
    );

    const ctx = {
      client,
      runId: input.run.run_id,
      videoId: input.run.video_id,
      analysisId: null as string | null,
      researchAsOf: isV2Intent(input.intent)
        ? input.intent.source.research_as_of
        : asIsoDate(input.run.research_as_of),
      videoPublishedAt: input.videoPublishedAt,
    };
    const operationReceipts: ExecutionReceipt["operations"] = [];
    for (const [index, operation] of input.intent.operations.entries()) {
      try {
        const result = await applyOperation(ctx, operation);
        if (result.analysisId) {
          ctx.analysisId = result.analysisId;
        }
        operationReceipts.push({
          operation_index: index,
          kind: operation.kind as ExecutionReceipt["operations"][number]["kind"],
          status: "applied",
          affected_table: result.affectedTable,
          affected_key: result.affectedKey,
          error_detail: null,
        });
        await clientQuery(
          client,
          `insert into public.research_ingestion_intent_event (
             intent_id, operation_index, operation_kind, status, affected_table, affected_key
           ) values ($1, $2, $3, 'applied', $4, $5)`,
          [input.ledger.intent_id, index, operation.kind, result.affectedTable, result.affectedKey],
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await clientQuery(
          client,
          `insert into public.research_ingestion_intent_event (
             intent_id, operation_index, operation_kind, status, error_detail
           ) values ($1, $2, $3, 'failed', $4)`,
          [input.ledger.intent_id, index, operation.kind, detail],
        );
        throw new ApplyIntentError("OPERATION_FAILED", `${operation.kind}: ${detail}`);
      }
    }

    if (!ctx.analysisId) {
      throw new ApplyIntentError("ANALYSIS_MISSING", "create_video_analysis did not produce analysis_id");
    }
    await assertEvidenceIdsExist(client, ctx.analysisId, referencedEvidenceIds(input.intent.operations));

    const appliedAt = new Date().toISOString();
    await clientQuery(
      client,
      `update public.research_ingestion_intent
          set status = 'applied',
              applied_at = timezone('utc', now()),
              error_detail = null
        where intent_id = $1`,
      [input.ledger.intent_id],
    );
    await clientQuery(
      client,
      `update public.research_pre_research_run
          set status = 'applied',
              completed_at = timezone('utc', now()),
              intent_path = coalesce(intent_path, $2),
              intent_sha256 = coalesce(intent_sha256, $3)
        where run_id = $1`,
      [input.run.run_id, input.ledger.storage_path, input.ledger.content_sha256],
    );
    await markFinalizing(client, input.run.video_id, input.run.run_id);

    return {
      alreadyApplied: false,
      prefix: input.prefix,
      receipt: buildReceipt({
        intent: input.intent,
        intentSha256: input.ledger.content_sha256,
        status: "applied",
        appliedAt,
        analysisId: ctx.analysisId,
        operations: operationReceipts,
        errorCode: null,
        errorDetail: null,
        prefix: input.prefix,
        finishedMarkerWritten: false,
        artifactCount: input.artifactCount,
      }),
    };
  });
}

async function finalizeReceipt(input: {
  receipt: ExecutionReceipt;
  run: RunRow;
  ledger: IntentLedgerRow;
  prefix: string;
  transcriptSha256: string;
}): Promise<ExecutionReceipt> {
  try {
    await registerExecutionReceipt({
      runId: input.run.run_id,
      intentId: input.ledger.intent_id,
      prefix: input.prefix,
      receipt: { ...input.receipt, finished_marker_written: false },
    });
    await markFinished({
      videoId: input.run.video_id,
      runId: input.run.run_id,
      intentId: input.ledger.intent_id,
      transcriptSha256: input.transcriptSha256,
    });
    return { ...input.receipt, finished_marker_written: true };
  } catch (error) {
    await query(`select research_private.project_pre_research_video_state($1, $2, 'finalizing')`, [
      input.run.video_id,
      input.run.run_id,
    ]).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApplyIntentError(
      "FINALIZATION_INCOMPLETE",
      `Intent is applied but receipt/finish is incomplete: ${detail}`,
    );
  }
}

export async function applyIntent(options: ApplyIntentOptions): Promise<ExecutionReceipt> {
  const ledger = await loadIntentRow(options);
  const run = await loadRun(ledger.run_id);
  const video = await loadVideoEligibility(run.video_id);
  const transcriptSha256 = assertEligibility(video, run.transcript_sha256);

  const downloaded = await downloadJsonObject(ledger.storage_bucket, ledger.storage_path);
  await writeHostArtifact(ledger.storage_path, downloaded.bytes);
  if (downloaded.sha256 !== ledger.content_sha256) {
    throw new ApplyIntentError(
      "INTENT_HASH_MISMATCH",
      `Downloaded intent hash ${downloaded.sha256} does not match ledger ${ledger.content_sha256}`,
    );
  }
  const registry = await query<ArtifactRow>(
    `select artifact_kind, storage_bucket, storage_path, content_sha256, schema_version
       from public.research_pre_research_artifact
      where run_id = $1 and artifact_kind = 'ingestion_intent'`,
    [run.run_id],
  );
  if (registry[0] && registry[0].content_sha256 !== downloaded.sha256) {
    throw new ApplyIntentError(
      "INTENT_HASH_MISMATCH",
      `Downloaded intent hash ${downloaded.sha256} does not match artifact registry ${registry[0].content_sha256}`,
    );
  }

  const intent = parseIngestionIntent(downloaded.json);
  if (intent.intent_id !== ledger.intent_id) {
    throw new ApplyIntentError("INTENT_ID_MISMATCH", "Intent file intent_id does not match the ledger");
  }
  if (intent.source.video_id !== run.video_id || intent.source.run_id !== run.run_id) {
    throw new ApplyIntentError("SOURCE_MISMATCH", "Intent source video/run does not match the run row");
  }
  if (intent.source.transcript_sha256 !== run.transcript_sha256) {
    throw new ApplyIntentError("TRANSCRIPT_HASH_MISMATCH", "Intent transcript hash does not match the run");
  }
  if (intent.source.taxonomy_version !== run.taxonomy_version || run.taxonomy_status !== "active") {
    throw new ApplyIntentError(
      "TAXONOMY_MISMATCH",
      `Intent taxonomy ${intent.source.taxonomy_version} is not the active run taxonomy ${run.taxonomy_version}`,
    );
  }
  if (intent.source.model_id !== "zai/glm-5.2" || intent.source.model_id !== run.model_id) {
    throw new ApplyIntentError("MODEL_MISMATCH", "Intent model_id must remain zai/glm-5.2");
  }
  if (intent.source.prompt_bundle_version !== run.prompt_bundle_version) {
    throw new ApplyIntentError("PROMPT_MISMATCH", "Intent prompt_bundle_version does not match the run");
  }
  const computedKey = computeIntentIdempotencyKey({
    schema_version: intent.schema_version,
    source: intent.source,
    evidence_grades_used: intent.evidence_grades_used,
    operations: intent.operations,
  });
  if (computedKey !== intent.idempotency_key || computedKey !== ledger.idempotency_key) {
    throw new ApplyIntentError("IDEMPOTENCY_MISMATCH", "Intent idempotency_key does not match canonical material");
  }

  const prefix = normalizePrefix(
    run.packet_storage_prefix ??
      packetStoragePrefix(run.video_id, run.run_id, run.packet_schema_version ?? intent.schema_version),
  );
  if (isV2Intent(intent)) {
    if (intent.source.research_as_of !== asIsoDate(run.research_as_of)) {
      throw new ApplyIntentError("RESEARCH_AS_OF_MISMATCH", "Intent research_as_of does not match the run");
    }
    if (intent.source.packet_schema_version !== PACKET_SCHEMA_VERSION) {
      throw new ApplyIntentError("PACKET_VERSION_MISMATCH", "Intent packet_schema_version must be 2.0.0");
    }
    const expectedPrefix = packetStoragePrefix(run.video_id, run.run_id, PACKET_SCHEMA_VERSION);
    if (prefix !== expectedPrefix) {
      throw new ApplyIntentError(
        "PACKET_PREFIX_MISMATCH",
        `Packet prefix ${prefix} does not match ${expectedPrefix}`,
      );
    }
  }

  let artifactCount = registry.length;
  if (isV2Intent(intent)) {
    const artifacts = await verifyRegisteredArtifacts({
      runId: run.run_id,
      prefix,
      kinds: APPLY_ARTIFACT_KINDS,
    });
    artifactCount = artifacts.length;
  }

  if (options.finalizeOnly && ledger.status !== "applied" && run.status !== "applied") {
    throw new ApplyIntentError(
      "NOT_APPLIED",
      "Cannot finalize; the intent has not been applied yet",
    );
  }
  if (options.finalizeOnly || ledger.status === "applied" || run.status === "applied") {
    const receipt = await reconstructAlreadyAppliedReceipt({
      intent,
      ledger,
      prefix,
      artifactCount,
    });
    return finalizeReceipt({
      receipt,
      run,
      ledger,
      prefix,
      transcriptSha256,
    });
  }

  let profile: {
    review_required?: boolean;
    unresolved_conflicts?: string[];
    primary_domain_code?: string;
    primary_featured_organization?: { primary_domain_code: string } | null;
  } | null = null;
  if (isV2Intent(intent)) {
    try {
      const profileObject = await downloadJsonObject(
        intentBucket(),
        artifactStoragePath(prefix, "organization_profile"),
      );
      profile = profileObject.json as typeof profile;
    } catch {
      profile = null;
    }
  }
  if (!options.approved) {
    const reasons = reviewRefusalReasons(intent, run, profile);
    if (reasons.length > 0) {
      throw new ApplyIntentError(
        "REVIEW_REQUIRED",
        `Automatic apply refused: ${reasons.join("; ")}`,
      );
    }
  }

  const committed = await applyInTransaction({
    ledger,
    run,
    intent,
    prefix,
    artifactCount,
    videoPublishedAt: video.published_at,
  });
  return finalizeReceipt({
    receipt: committed.receipt,
    run,
    ledger,
    prefix,
    transcriptSha256,
  });
}

export function hashIntent(intent: ParsedIngestionIntent): string {
  return hashCanonicalJson(intent);
}

export { parseExecutionReceipt };
export type { ParsedExecutionReceipt };
