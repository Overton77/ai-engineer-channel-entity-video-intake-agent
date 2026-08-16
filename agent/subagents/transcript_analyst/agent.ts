import { defineResearchSubagent } from "../../lib/research-subagent";

export default defineResearchSubagent({
  description:
    "Produce a transcript-only summary, takeaways, structured SE/AI concept candidates, limitations, and evidence anchors. No web access. No present-day claims.",
  reasoning: "medium",
});
