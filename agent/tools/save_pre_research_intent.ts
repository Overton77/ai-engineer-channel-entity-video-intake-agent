import { defineTool } from "eve/tools";
import { ingestionIntentSchema } from "../../contracts/ingestion-intent";

export default defineTool({
  description:
    "Deprecated. v1-only intent saves are rejected. Use save_pre_research_packet to persist v2 artifacts 60-90 after the run is synthesizing.",
  inputSchema: ingestionIntentSchema,
  async execute() {
    throw new Error(
      "save_pre_research_intent is deprecated. Call save_pre_research_packet with 60-initial-summary, 70-technology-library-summary, 80-organization-profile, and 90-ingestion-intent. v1-only intent saves are rejected.",
    );
  },
});
