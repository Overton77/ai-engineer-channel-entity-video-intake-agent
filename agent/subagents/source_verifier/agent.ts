import { defineResearchSubagent } from "../../lib/research-subagent";

export default defineResearchSubagent({
  description:
    "Verify ownership, naming/status, library relationships, organization hierarchy, organization-domain rationale, and the authoritative-source minimum with Exa web_search. Reject parent/unit/product relationships supported only by inference.",
  reasoning: "medium",
});
