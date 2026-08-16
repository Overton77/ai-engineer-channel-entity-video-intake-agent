import { defineResearchSubagent } from "../../lib/research-subagent";

export default defineResearchSubagent({
  description:
    "Assign exactly one primary AI engineering category, up to three secondary categories, domains, lifecycle, difficulty, and content form. No web access.",
  reasoning: "medium",
});
