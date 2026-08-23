import assert from "node:assert/strict";
import test from "node:test";
import {
  entityRankingSnapshotSchema,
  metricObservationSchema,
} from "../contracts/entity-ranking";

test("metric observations require provenance and measurement confidence", () => {
  const parsed = metricObservationSchema.parse({
    observation_id: "obs_github_langgraph_stars_20260823",
    entity_id: "repo:github:langchain-ai/langgraph",
    entity_kind: "repository",
    metric_key: "github.repo.stars_total",
    value: 40254,
    unit: "stars",
    scope: { host: "github.com", repository: "langchain-ai/langgraph" },
    source_class: "official_api",
    source_locator: "https://api.github.com/repos/langchain-ai/langgraph",
    collector: "github-rest-v2022-11-28",
    collection_method: "authenticated_rest",
    observed_at: "2026-08-23T00:47:54.328Z",
    identity_resolution_id: "resolve_repo_langgraph_v1",
    source_reliability: 0.98,
    identity_confidence: 1,
  });

  assert.equal(parsed.metric_key, "github.repo.stars_total");
});

test("ranking snapshots keep purpose, uncertainty, and direct score separate", () => {
  const parsed = entityRankingSnapshotSchema.parse({
    ranking_snapshot_id: "rank_beacon_20260823",
    campaign_id: "campaign_agent_orchestration_2026q3",
    entity_id: "library:beacon",
    entity_kind: "library",
    purpose: "research_next",
    audience: "intermediate_production_engineer",
    as_of: "2026-08-23T00:00:00Z",
    policy_version: "entity-rank-0.1.0",
    taxonomy_version: "taxonomy-1.1.0",
    cohort_ids: ["pypi:agent-orchestration:age-1-2y"],
    point_score: 0.7126,
    conservative_score: 0.6626,
    confidence: 0.67,
    interval_90: [0.54, 0.86],
    direct_only_score: 0.7001,
    propagation_contribution: 0.0125,
    feature_contributions: { expected_information_gain: 0.1494 },
    missing_features: ["verified_production_case_studies"],
    penalties: { saturation: 0.0216 },
    explanation_codes: ["HIGH_INFORMATION_GAIN"],
    observation_ids: ["obs_1"],
    eligible: true,
    ineligibility_reasons: [],
    rank: 1,
  });

  assert.ok(parsed.conservative_score < parsed.point_score);
});
