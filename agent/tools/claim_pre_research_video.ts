import { defineTool } from "eve/tools";
import { z } from "zod";
import { query } from "../lib/postgres";
import { PACKET_SCHEMA_VERSION, PROMPT_BUNDLE_VERSION, TAXONOMY_VERSION } from "../../contracts/enums";

type ClaimRow = {
  claim: unknown;
};

export default defineTool({
  description:
    "Atomically claim one eligible research_starter_videos row. Pass video_id to claim that video. Omit video_id to claim the oldest stored transcript with no live or applied run for the current hash. Uses FOR UPDATE SKIP LOCKED. Returns run metadata and video metadata without transcript text.",
  inputSchema: z.object({
    video_id: z
      .string()
      .min(1)
      .optional()
      .describe("YouTube video_id to claim. Omit to claim the next oldest eligible video."),
    lease_seconds: z.number().int().min(60).max(21600).default(1800),
    taxonomy_version: z.string().min(1).default(TAXONOMY_VERSION),
  }),
  async execute({ video_id, lease_seconds, taxonomy_version }) {
    const rows = await query<ClaimRow>(
      `select research_private.claim_pre_research_video($1, $2, $3, $4, $5, $6) as claim`,
      [
        lease_seconds,
        taxonomy_version,
        PROMPT_BUNDLE_VERSION,
        "zai/glm-5.2",
        PACKET_SCHEMA_VERSION,
        video_id ?? null,
      ],
    );
    return rows[0]?.claim ?? { claimed: false, reason: "EMPTY_RESULT" };
  },
});
