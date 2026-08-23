import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  curriculumSignalsSchema,
  filterKnownEvidenceIds,
  organizationResearchSchema,
  runManifestSchema,
  sourceVerificationSchema,
  taxonomyClassificationSchema,
  transcriptAnalysisSchema,
  validatePartialResearchPhasePacketCrossFile,
  validateResearchPhasePacketCrossFile,
  webContextSchema,
  type ResearchPhasePacket,
} from "../../contracts/pre-research-packet";
import {
  commitArtifact,
  downloadVerifiedArtifact,
  listRegisteredArtifacts,
} from "../lib/artifact-registry";
import {
  artifactRelativePath,
  packetStoragePrefix,
  RESEARCH_ARTIFACT_FILES,
} from "../lib/artifact-storage";
import {
  assertResearchPhaseAccess,
  assertRunMatchesPacket,
  loadPreResearchRun,
} from "../lib/run-access";
import { isSynthesisTurn, researchStageFromMessages } from "../lib/turn-capabilities";

const transcriptTaxonomyStageSchema = z.object({
  stage: z.literal("transcript_taxonomy"),
  run_manifest: runManifestSchema,
  transcript_analysis: transcriptAnalysisSchema,
  taxonomy_classification: taxonomyClassificationSchema,
});

const webContextStageSchema = z.object({
  stage: z.literal("web_context"),
  run_id: z.string().uuid(),
  web_context: webContextSchema,
});

const organizationResearchStageSchema = z.object({
  stage: z.literal("organization_research"),
  run_id: z.string().uuid(),
  organization_research: organizationResearchSchema,
});

const sourceVerificationStageSchema = z.object({
  stage: z.literal("source_verification"),
  run_id: z.string().uuid(),
  source_verification: sourceVerificationSchema,
});

const curriculumStageSchema = z.object({
  stage: z.literal("curriculum"),
  run_id: z.string().uuid(),
  curriculum_signals: curriculumSignalsSchema,
});

const researchStagePacketSchema = z.discriminatedUnion("stage", [
  transcriptTaxonomyStageSchema,
  webContextStageSchema,
  organizationResearchStageSchema,
  sourceVerificationStageSchema,
  curriculumStageSchema,
]);

const stageKinds = {
  transcript_taxonomy: ["run_manifest", "transcript_analysis", "taxonomy_classification"],
  web_context: ["web_context"],
  organization_research: ["organization_research"],
  source_verification: ["source_verification"],
  curriculum: ["curriculum_signals"],
} as const;

async function loadPriorPacket(runId: string): Promise<Partial<ResearchPhasePacket>> {
  const rows = await listRegisteredArtifacts(runId);
  const packet: Partial<ResearchPhasePacket> = {};
  for (const row of rows) {
    if (!(row.artifact_kind in RESEARCH_ARTIFACT_FILES)) continue;
    packet[row.artifact_kind as keyof ResearchPhasePacket] =
      (await downloadVerifiedArtifact(row)) as never;
  }
  return packet;
}

export default defineDynamic({
  events: {
    "step.started": (_event, resolveCtx) => {
      if (isSynthesisTurn(resolveCtx.messages)) return null;
      const stage = researchStageFromMessages(resolveCtx.messages);
      const inputSchema =
        stage === "web_context"
          ? webContextStageSchema
          : stage === "organization_research"
            ? organizationResearchStageSchema
            : stage === "source_verification"
              ? sourceVerificationStageSchema
          : stage === "curriculum"
            ? curriculumStageSchema
            : transcriptTaxonomyStageSchema;
      return defineTool({
        description:
          `Validate and durably persist only the ${stage ?? "transcript_taxonomy"} research checkpoint stage. Prior registered stages are hash-verified and cross-file validated before later artifacts are committed.`,
        inputSchema,
        async execute(raw, ctx) {
    const input = researchStagePacketSchema.parse(raw);
    const runId = input.stage === "transcript_taxonomy" ? input.run_manifest.run_id : input.run_id;
    const run = await loadPreResearchRun(runId);
    assertResearchPhaseAccess(run, ctx.session.id);

    const registeredBefore = await listRegisteredArtifacts(runId);
    const requiredKinds = stageKinds[input.stage];
    const alreadyRegistered = requiredKinds
      .map((kind) => registeredBefore.find((row) => row.artifact_kind === kind))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (alreadyRegistered.length === requiredKinds.length) {
      return {
        saved: true as const,
        already_saved: true as const,
        phase: "research" as const,
        stage: input.stage,
        run_id: run.run_id,
        video_id: run.video_id,
        packet_storage_prefix: packetStoragePrefix(run.video_id, run.run_id),
        artifacts: alreadyRegistered.map((row) => ({
          kind: row.artifact_kind,
          storage_bucket: row.storage_bucket,
          storage_path: row.storage_path,
          content_sha256: row.content_sha256,
          byte_count: row.byte_count,
        })),
        research_packet_complete: input.stage === "curriculum",
      };
    }

    const prior = await loadPriorPacket(runId);
    const manifest = prior.run_manifest;
    if (input.stage !== "transcript_taxonomy" && !manifest) {
      throw new Error("RESEARCH_STAGE_ORDER: transcript_taxonomy must be saved first");
    }
    const immutableIdentity = manifest
      ? {
          schema_version: manifest.schema_version,
          run_id: manifest.run_id,
          video_id: manifest.video_id,
          transcript_sha256: manifest.transcript_sha256,
          research_as_of: manifest.research_as_of,
        }
      : null;
    const knownEvidenceIds = new Set(
      prior.transcript_analysis?.evidence_anchors.map((anchor) => anchor.evidence_id) ?? [],
    );
    const sanitizedOrganizationResearch = input.stage === "organization_research"
      ? {
          ...input.organization_research,
          candidates: input.organization_research.candidates.map((candidate) => ({
            ...candidate,
            evidence_ids: filterKnownEvidenceIds(candidate.evidence_ids, knownEvidenceIds),
          })),
          featured_implementation: input.organization_research.featured_implementation
            ? {
                ...input.organization_research.featured_implementation,
                evidence_ids: filterKnownEvidenceIds(
                  input.organization_research.featured_implementation.evidence_ids,
                  knownEvidenceIds,
                ),
              }
            : null,
          speaker_employer: input.organization_research.speaker_employer
            ? {
                ...input.organization_research.speaker_employer,
                evidence_ids: filterKnownEvidenceIds(
                  input.organization_research.speaker_employer.evidence_ids,
                  knownEvidenceIds,
                ),
              }
            : null,
        }
      : null;
    const additions: Partial<ResearchPhasePacket> =
      input.stage === "transcript_taxonomy"
        ? {
            run_manifest: input.run_manifest,
            transcript_analysis: input.transcript_analysis,
            taxonomy_classification: input.taxonomy_classification,
          }
        : input.stage === "web_context"
          ? {
              web_context: {
                ...input.web_context,
                ...immutableIdentity!,
                video_published_at: manifest!.video_published_at,
              },
            }
          : input.stage === "organization_research"
            ? {
                organization_research: {
                  ...sanitizedOrganizationResearch!,
                  ...immutableIdentity!,
                  video_published_at: manifest!.video_published_at,
                },
              }
            : input.stage === "source_verification"
              ? {
                  source_verification: {
                    ...input.source_verification,
                    ...immutableIdentity!,
                  },
                }
          : {
              curriculum_signals: {
                ...input.curriculum_signals,
                ...immutableIdentity!,
              },
            };
    const packet = { ...prior, ...additions } as Partial<ResearchPhasePacket>;

    if (!packet.run_manifest || !packet.transcript_analysis) {
      throw new Error("RESEARCH_STAGE_ORDER: transcript_taxonomy must be saved first");
    }
    assertRunMatchesPacket(run, packet.run_manifest);
    const cross =
      input.stage === "curriculum"
        ? validateResearchPhasePacketCrossFile(packet as ResearchPhasePacket)
        : validatePartialResearchPhasePacketCrossFile(
            packet as Parameters<typeof validatePartialResearchPhasePacketCrossFile>[0],
          );
    if (!cross.ok) {
      throw new Error(`RESEARCH_PACKET_CROSS_FILE: ${cross.errors.join("; ")}`);
    }

    const artifacts = [];
    for (const kind of stageKinds[input.stage]) {
      const value = additions[kind as keyof ResearchPhasePacket];
      if (!value) throw new Error(`RESEARCH_STAGE_MISSING: ${kind}`);
      artifacts.push(
        await commitArtifact({
          runId,
          artifactKind: kind,
          schemaVersion: value.schema_version,
          relativePath: artifactRelativePath(
            run.video_id,
            run.run_id,
            RESEARCH_ARTIFACT_FILES[kind],
          ),
          value,
        }),
      );
    }

    return {
      saved: true as const,
      phase: "research" as const,
      stage: input.stage,
      run_id: run.run_id,
      video_id: run.video_id,
      packet_storage_prefix: packetStoragePrefix(run.video_id, run.run_id),
      artifacts,
      research_packet_complete: input.stage === "curriculum",
    };
        },
      });
    },
  },
});
