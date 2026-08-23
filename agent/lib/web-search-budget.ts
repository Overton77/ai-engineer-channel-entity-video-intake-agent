import type { ResearchStageName } from "./turn-capabilities";

export type WebSearchLedgerLabel =
  | "web_context_scout"
  | "organization_researcher"
  | "source_verifier";

export function webSearchLedgerLabelForStage(
  stage: ResearchStageName | null,
): WebSearchLedgerLabel | null {
  if (stage === "web_context") return "web_context_scout";
  if (stage === "organization_research") return "organization_researcher";
  if (stage === "source_verification") return "source_verifier";
  return null;
}

export function webSearchLedgerCap(label: WebSearchLedgerLabel): number {
  return label === "source_verifier" ? 2 : 3;
}
