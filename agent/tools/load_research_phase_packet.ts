import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadRegisteredResearchPacket } from "../lib/artifact-registry";
import { packetStoragePrefix } from "../lib/artifact-storage";
import {
  assertLoadResearchPhaseAccess,
  loadPreResearchRun,
} from "../lib/run-access";

export default defineTool({
  description:
    "Synthesis-only. Download the registered 00-50 research checkpoint for a run from research-ingestion-intents, verify every SHA-256, and return the parsed artifacts. Rejects unregistered paths. Requires run status research_complete or synthesizing.",
  inputSchema: z.object({
    run_id: z.uuid(),
  }),
  async execute({ run_id }, ctx) {
    const run = await loadPreResearchRun(run_id);
    assertLoadResearchPhaseAccess(run, ctx.session.id);

    const { packet, artifacts } = await loadRegisteredResearchPacket(run.run_id);

    return {
      loaded: true as const,
      phase: "synthesis" as const,
      run_id: run.run_id,
      video_id: run.video_id,
      status: run.status,
      packet_storage_prefix: run.packet_storage_prefix ?? packetStoragePrefix(run.video_id, run.run_id),
      artifacts: artifacts.map((row) => ({
        kind: row.artifact_kind,
        storage_bucket: row.storage_bucket,
        storage_path: row.storage_path,
        content_sha256: row.content_sha256,
        byte_count: row.byte_count,
      })),
      packet,
    };
  },
});
