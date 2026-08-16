import { defineTool } from "eve/tools";
import { z } from "zod";
import { INTENT_BUCKET } from "../../contracts/enums";
import {
  computeIntentIdempotencyKey,
  ingestionIntentSchema,
} from "../../contracts/ingestion-intent";
import { validateAuthoritativeSourceMinimum } from "../../contracts/organization-invariants";
import {
  initialSummarySchema,
  organizationProfileSchema,
  technologyLibrarySummarySchema,
  validatePreResearchPacketCrossFile,
  type PreResearchPacket,
} from "../../contracts/pre-research-packet";
import {
  commitArtifact,
  listRegisteredArtifacts,
  loadRegisteredResearchPacket,
  packetManifestHash,
  RESEARCH_PHASE_KINDS,
  SYNTHESIS_PHASE_KINDS,
} from "../lib/artifact-registry";
import {
  artifactRelativePath,
  packetStoragePrefix,
  SYNTHESIS_ARTIFACT_FILES,
} from "../lib/artifact-storage";
import { query } from "../lib/postgres";
import {
  assertRunMatchesPacket,
  assertSynthesisPhaseAccess,
  loadPreResearchRun,
  optionalSandbox,
} from "../lib/run-access";

const synthesisPacketSchema = z.object({
  initial_summary: initialSummarySchema,
  technology_library_summary: technologyLibrarySummarySchema,
  organization_profile: organizationProfileSchema,
  ingestion_intent: ingestionIntentSchema,
});

function synthesisReviewReasons(packet: PreResearchPacket): string[] {
  const reasons: string[] = [];
  const analysisOp = packet.ingestion_intent.operations.find(
    (operation) => operation.kind === "create_video_analysis",
  );
  if (
    analysisOp?.kind === "create_video_analysis" &&
    analysisOp.payload.overall_confidence < 0.7
  ) {
    reasons.push("overall_confidence_below_0.70");
  }

  const profile = packet.organization_profile;
  if (profile.primary_domain_code === "other_unknown" || !profile.primary_featured_organization) {
    reasons.push("primary_organization_domain_other_unknown");
  } else {
    const sourceCheck = validateAuthoritativeSourceMinimum(
      profile.sources.filter(
        (source) =>
          source.organization_candidate_id ===
          profile.primary_featured_organization?.organization_candidate_id,
      ),
    );
    if (!sourceCheck.ok) {
      reasons.push("authoritative_source_minimum_failed");
    }
  }

  return [...new Set(reasons)];
}

export default defineTool({
  description:
    "Synthesis-only. Validate 60, 70, 80, and 90 against the registered 00-50 checkpoint, upload them to research-ingestion-intents, register artifacts after upload, write the intent ledger only after all 00-90 objects exist, and complete the synthesis phase as intent_ready or review_required. Does not store raw transcript text and does not mark the pipeline finished.",
  inputSchema: synthesisPacketSchema,
  async execute(input, ctx) {
    const synthesis = synthesisPacketSchema.parse(input);
    const expectedKey = computeIntentIdempotencyKey({
      schema_version: synthesis.ingestion_intent.schema_version,
      source: synthesis.ingestion_intent.source,
      evidence_grades_used: synthesis.ingestion_intent.evidence_grades_used,
      operations: synthesis.ingestion_intent.operations,
    });
    if (synthesis.ingestion_intent.idempotency_key !== expectedKey) {
      throw new Error("IDEMPOTENCY_KEY_MISMATCH: recompute idempotency_key from canonical source+operations");
    }

    const run = await loadPreResearchRun(synthesis.ingestion_intent.source.run_id);
    assertSynthesisPhaseAccess(run, ctx.session.id);
    assertRunMatchesPacket(run, {
      run_id: synthesis.ingestion_intent.source.run_id,
      video_id: synthesis.ingestion_intent.source.video_id,
      transcript_sha256: synthesis.ingestion_intent.source.transcript_sha256,
    });

    const { packet: research } = await loadRegisteredResearchPacket(run.run_id);
    const packet: PreResearchPacket = {
      ...research,
      initial_summary: synthesis.initial_summary,
      technology_library_summary: synthesis.technology_library_summary,
      organization_profile: synthesis.organization_profile,
      ingestion_intent: synthesis.ingestion_intent,
      evidence_grades_used: synthesis.ingestion_intent.evidence_grades_used,
    };
    const cross = validatePreResearchPacketCrossFile(packet);
    if (!cross.ok) {
      throw new Error(`PACKET_CROSS_FILE: ${cross.errors.join("; ")}`);
    }

    const sandbox = await optionalSandbox(ctx);
    const prefix = packetStoragePrefix(run.video_id, run.run_id);
    const uploaded = [];
    for (const kind of SYNTHESIS_PHASE_KINDS) {
      uploaded.push(
        await commitArtifact({
          runId: run.run_id,
          artifactKind: kind,
          schemaVersion: packet[kind].schema_version,
          relativePath: artifactRelativePath(run.video_id, run.run_id, SYNTHESIS_ARTIFACT_FILES[kind]),
          value: packet[kind],
          sandbox,
        }),
      );
    }

    const registered = await listRegisteredArtifacts(run.run_id);
    const present = new Set(registered.map((row) => row.artifact_kind));
    const required = [...RESEARCH_PHASE_KINDS, ...SYNTHESIS_PHASE_KINDS];
    const missing = required.filter((kind) => !present.has(kind));
    if (missing.length > 0) {
      throw new Error(`PACKET_INCOMPLETE: missing registered artifacts ${missing.join(", ")}`);
    }

    const intentPath = `pre-research/${artifactRelativePath(
      run.video_id,
      run.run_id,
      SYNTHESIS_ARTIFACT_FILES.ingestion_intent,
    )}`;
    const intentSha = uploaded.find((row) => row.kind === "ingestion_intent")?.content_sha256;
    if (!intentSha) {
      throw new Error("PACKET_INCOMPLETE: ingestion_intent hash missing after upload");
    }

    const intentRows = await query<{ intent_id: string; content_sha256: string; status: string }>(
      `insert into public.research_ingestion_intent (
         intent_id, run_id, video_id, schema_version, idempotency_key,
         storage_bucket, storage_path, content_sha256, status, validated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'validated', timezone('utc', now()))
       on conflict (run_id) do update
       set
         schema_version = excluded.schema_version,
         idempotency_key = excluded.idempotency_key,
         storage_bucket = excluded.storage_bucket,
         storage_path = excluded.storage_path,
         status = 'validated',
         validated_at = excluded.validated_at
       where public.research_ingestion_intent.content_sha256 = excluded.content_sha256
         and public.research_ingestion_intent.status in ('draft', 'validated')
       returning intent_id, content_sha256, status`,
      [
        synthesis.ingestion_intent.intent_id,
        run.run_id,
        run.video_id,
        synthesis.ingestion_intent.schema_version,
        synthesis.ingestion_intent.idempotency_key,
        INTENT_BUCKET,
        intentPath,
        intentSha,
      ],
    );
    const intentRow = intentRows[0];
    if (!intentRow) {
      throw new Error(
        "INTENT_CONTENT_COLLISION: research_ingestion_intent already exists for this run with different content",
      );
    }

    const packetSha = packetManifestHash(prefix, registered);
    await query(
      `update public.research_pre_research_run
       set
         intent_path = $2,
         intent_sha256 = $3,
         packet_storage_prefix = $4,
         packet_sha256 = $5
       where run_id = $1`,
      [run.run_id, intentPath, intentSha, prefix, packetSha],
    );

    const reviewReasons = synthesisReviewReasons(packet);
    const nextStatus = reviewReasons.length > 0 ? "review_required" : "intent_ready";

    let phaseTransitionError: string | null = null;
    try {
      await query(
        `select research_private.complete_synthesis_phase(
           $1::uuid,
           $2::text,
           $3::public.research_pre_research_run_status
         ) as result`,
        [run.run_id, ctx.session.id, nextStatus],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      phaseTransitionError =
        `COMPLETE_SYNTHESIS_PHASE_FAILED: ${message}. Artifacts 60-90 are uploaded and the intent ledger is written; apply the v2 phase RPCs and retry.`;
    }

    return {
      saved: true as const,
      phase: "synthesis" as const,
      run_id: run.run_id,
      video_id: run.video_id,
      intent_id: intentRow.intent_id,
      next_status: nextStatus,
      review_reasons: reviewReasons,
      packet_storage_prefix: prefix,
      packet_sha256: packetSha,
      intent_path: intentPath,
      intent_sha256: intentSha,
      artifacts: uploaded,
      phase_transition_error: phaseTransitionError,
      note: "Synthesis packet uploaded and registered. Do not mark the pipeline finished from this tool.",
    };
  },
});
