import { defineResearchSubagent } from "../../lib/research-subagent";

export default defineResearchSubagent({
  description:
    "Find official docs, repos, changelogs, product pages, and speaker/company context with Eve web_search using Exa. Include the technology name and runtime year. Budget 4-6 searches.",
  reasoning: "medium",
});
