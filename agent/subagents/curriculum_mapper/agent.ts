import { defineResearchSubagent } from "../../lib/research-subagent";

export default defineResearchSubagent({
  description:
    "Map pre-curriculum signals only: role, placement, labs, challenges, learner level. May consume concept candidates. Must not create 60/70/80. No web access.",
  reasoning: "low",
});
