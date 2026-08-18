import { defineTool } from "eve/tools";
import { z } from "zod";
import { asIsoDate, loadPreResearchRun } from "../lib/run-access";

export default defineTool({
  description:
    "Load one research_pre_research_run by run_id. Returns video_id, status, transcript_sha256, packet prefix, and research_as_of. Use this when the controller already claimed the video and you only have run_id. Do not call claim_pre_research_video. Do not call touch_pre_research_run. lease_token is not required.",
  inputSchema: z.object({
    run_id: z.uuid(),
  }),
  async execute({ run_id }) {
    const run = await loadPreResearchRun(run_id);
    return {
      found: true as const,
      run: {
        run_id: run.run_id,
        video_id: run.video_id,
        status: run.status,
        transcript_sha256: run.transcript_sha256,
        packet_schema_version: run.packet_schema_version,
        packet_storage_prefix: run.packet_storage_prefix,
        research_as_of: asIsoDate(run.research_as_of),
      },
    };
  },
});
