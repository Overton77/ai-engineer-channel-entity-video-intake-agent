import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  curriculumSignalsSchema,
  organizationResearchSchema,
  runManifestSchema,
  sourceVerificationSchema,
  taxonomyClassificationSchema,
  transcriptAnalysisSchema,
  validateResearchPhasePacketCrossFile,
  webContextSchema,
} from "../../contracts/pre-research-packet";
import {
  commitArtifact,
  RESEARCH_PHASE_KINDS,
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
  optionalSandbox,
} from "../lib/run-access";

const researchPhasePacketSchema = z.object({
  run_manifest: runManifestSchema,
  transcript_analysis: transcriptAnalysisSchema,
  taxonomy_classification: taxonomyClassificationSchema,
  web_context: webContextSchema,
  organization_research: organizationResearchSchema,
  source_verification: sourceVerificationSchema,
  curriculum_signals: curriculumSignalsSchema,
});

export default defineTool({
  description:
    "Validate and durably persist research-phase artifacts 00-50 (including 35-organization-research) to local outputs, the session sandbox, and research-ingestion-intents. Registers artifacts only after upload. Does not write 60-90, does not store raw transcript text, and does not mark research_complete.",
  inputSchema: researchPhasePacketSchema,
  async execute(input, ctx) {
    const packet = researchPhasePacketSchema.parse(input);
    const cross = validateResearchPhasePacketCrossFile(packet);
    if (!cross.ok) {
      throw new Error(`RESEARCH_PACKET_CROSS_FILE: ${cross.errors.join("; ")}`);
    }

    const run = await loadPreResearchRun(packet.run_manifest.run_id);
    assertResearchPhaseAccess(run, ctx.session.id);
    assertRunMatchesPacket(run, packet.run_manifest);

    const sandbox = await optionalSandbox(ctx);
    const prefix = packetStoragePrefix(run.video_id, run.run_id);
    const artifacts = [];
    for (const kind of RESEARCH_PHASE_KINDS) {
      artifacts.push(
        await commitArtifact({
          runId: run.run_id,
          artifactKind: kind,
          schemaVersion: packet[kind].schema_version,
          relativePath: artifactRelativePath(run.video_id, run.run_id, RESEARCH_ARTIFACT_FILES[kind]),
          value: packet[kind],
          sandbox,
        }),
      );
    }

    return {
      saved: true as const,
      phase: "research" as const,
      run_id: run.run_id,
      video_id: run.video_id,
      packet_storage_prefix: prefix,
      research_complete: false as const,
      artifacts,
      note: "Research checkpoint uploaded and registered. Do not mark research_complete from this tool. Trusted controller code verifies hashes and performs that transition.",
    };
  },
});
