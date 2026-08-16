import { defineResearchSubagent } from "../../lib/research-subagent";

export default defineResearchSubagent({
  description:
    "Identify the implementation, narrowest owning organization/unit, parent, speaker affiliation, current and video-time names, proposed organization-domain classification, and 3-6 candidate authoritative sources. Writes 35-organization-research.json. Proposes only; does not declare sources verified. Must use Exa web_search.",
  reasoning: "medium",
});
