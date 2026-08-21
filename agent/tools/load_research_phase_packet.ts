import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  downloadVerifiedArtifact,
  listRegisteredArtifacts,
  loadRegisteredResearchPacket,
} from "../lib/artifact-registry";
import { packetStoragePrefix } from "../lib/artifact-storage";
import {
  assertLoadResearchPhaseAccess,
  loadPreResearchRun,
} from "../lib/run-access";
import { synthesisStageFromMessages } from "../lib/turn-capabilities";

const researchKindsByStage = {
  initial_summary: [
    "run_manifest",
    "transcript_analysis",
    "taxonomy_classification",
    "web_context",
    "source_verification",
    "curriculum_signals",
  ],
  technology_library_summary: [
    "run_manifest",
    "transcript_analysis",
    "taxonomy_classification",
    "web_context",
    "source_verification",
  ],
  organization_profile: [
    "run_manifest",
    "web_context",
    "organization_research",
    "source_verification",
  ],
  ingestion_intent: [
    "run_manifest",
    "transcript_analysis",
    "taxonomy_classification",
    "web_context",
    "organization_research",
    "source_verification",
    "curriculum_signals",
  ],
} as const;

export default defineDynamic({
  events: {
    "step.started": (_event, resolveCtx) => {
      const stage = synthesisStageFromMessages(resolveCtx.messages);
      if (!stage) return null;
      return defineTool({
        description: `Synthesis stage ${stage} only. Download the minimum registered context needed for this stage, verify every SHA-256, and include already completed synthesis artifacts.`,
        inputSchema: z.object({ run_id: z.uuid() }),
        async execute({ run_id }, ctx) {
          const run = await loadPreResearchRun(run_id);
          assertLoadResearchPhaseAccess(run, ctx.session.id);

          const { packet, artifacts } = await loadRegisteredResearchPacket(run.run_id);
          const selectedPacket: Record<string, unknown> = {};
          for (const kind of researchKindsByStage[stage]) selectedPacket[kind] = packet[kind];
          const registered = await listRegisteredArtifacts(run.run_id);
          const synthesis: Record<string, unknown> = {};
          for (const row of registered) {
            if (
              !["initial_summary", "technology_library_summary", "organization_profile"].includes(
                row.artifact_kind,
              )
            ) {
              continue;
            }
            synthesis[row.artifact_kind] = await downloadVerifiedArtifact(row);
          }

          return {
            loaded: true as const,
            phase: "synthesis" as const,
            stage,
            run_id: run.run_id,
            video_id: run.video_id,
            status: run.status,
            packet_storage_prefix:
              run.packet_storage_prefix ?? packetStoragePrefix(run.video_id, run.run_id),
            artifacts: artifacts.map((row) => ({
              kind: row.artifact_kind,
              storage_bucket: row.storage_bucket,
              storage_path: row.storage_path,
              content_sha256: row.content_sha256,
              byte_count: row.byte_count,
            })),
            packet: selectedPacket,
            prior_synthesis: synthesis,
          };
        },
      });
    },
  },
});
