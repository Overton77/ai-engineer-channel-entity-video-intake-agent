import type { ResearchStageName } from "./turn-capabilities";

export function stageAllowsWebFetch(stage: ResearchStageName | null): boolean {
  return (
    stage === "web_context" ||
    stage === "organization_research" ||
    stage === "source_verification"
  );
}
