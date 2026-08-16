import { intentOperationKinds } from "../contracts/ingestion-intent";

export const allowedOperationKinds = intentOperationKinds;

export const operationTableMap = {
  create_video_analysis: "research_video_analysis",
  create_contextualized_initial_summary: "research_video_initial_summary",
  replace_technology_library_summaries: "research_video_technology_summary",
  replace_category_assignments: "research_video_category",
  replace_domain_assignments: "research_video_domain",
  replace_lifecycle_assignments: "research_video_lifecycle",
  replace_evidence_anchors: "research_evidence_anchor",
  replace_organization_candidates: "research_organization_candidate",
  replace_organization_sources: "research_organization_source",
  upsert_resource_candidates: "research_resource_candidate",
  upsert_entity_candidates: "research_entity_candidate",
  record_web_search_events: "research_web_search_event",
} as const;

export type OperationKind = keyof typeof operationTableMap;

export function tableForOperationKind(kind: string): string {
  if (kind === "execute_sql" || !(kind in operationTableMap)) {
    throw new Error(`Unknown or forbidden operation kind: ${kind}`);
  }
  return operationTableMap[kind as OperationKind];
}
