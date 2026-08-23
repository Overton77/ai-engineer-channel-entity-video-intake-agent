# Source ranking, domain prioritization, and evaluation specification

**Status:** proposed policy `source-rank-0.1.0`  
**Principle:** ranking is a versioned decision record, not a model adjective

## 1. Separate the ranking problems

Persist five distinct rankings:

1. **Source-for-purpose:** which source best supports this claim/question?
2. **Evidence:** which anchor is strongest for an assertion?
3. **Entity frontier:** which person, library, paper, product, or relationship should be researched next?
4. **Domain portfolio:** where should the campaign spend its next budget?
5. **Research job:** which bounded job should execute next given value, uncertainty, cost, and diversity?

Every result stores `policy_version`, full feature vector, missing-feature flags, penalties, final score, rank, eligibility, and explanation codes.

## 2. Eligibility gates

A candidate is ineligible for automatic selection when any required condition fails:

- locator cannot be normalized or fetched under policy;
- artifact has no observation time or digest;
- source class is disallowed for the intended use;
- it is a duplicate of a stronger candidate;
- claimed official identity cannot be verified;
- content is search-result text without a retrievable source;
- evidence anchor is missing for a factual assertion;
- prompt injection or unsafe executable content is not isolated;
- licensing/storage policy is unresolved when copying is required.

Ineligible does not mean deleted. Persist the reason for discovery-only use or review.

## 3. Source feature model

Score features on `[0,1]` with source-class-specific rubrics:

| Feature | Meaning |
| --- | --- |
| `authority` | first-party, standards, primary research, or established secondary authority appropriate to the claim |
| `claim_fit` | directly answers the question rather than mentioning the topic |
| `evidence_density` | inspectable details, data, code, methods, or anchored claims |
| `technical_depth` | useful to an advanced production engineer |
| `reproducibility` | inspectable code, configuration, dataset, benchmark, or steps |
| `curriculum_leverage` | supports concepts, trade-offs, labs, challenges, or projects |
| `freshness_fit` | current enough for the source class and as-of policy |
| `novelty` | adds non-duplicate information or contrary evidence |
| `graph_leverage` | resolves important entities/relationships or bridges domains |
| `accessibility` | stable locator, parse quality, anchors, and retrievability |

Penalties are `promotional_risk`, `staleness_risk`, `conflict_risk`, `extraction_risk`, and `redundancy`.

### 3.1 Deterministic v0

```text
base =
  0.18 * authority
  0.16 * claim_fit
  0.13 * evidence_density
  0.11 * technical_depth
  0.10 * reproducibility
  0.10 * curriculum_leverage
  0.08 * freshness_fit
  0.06 * novelty
  0.05 * graph_leverage
  0.03 * accessibility

penalty =
  0.08 * promotional_risk
  0.10 * staleness_risk
  0.10 * conflict_risk
  0.08 * extraction_risk
  0.12 * redundancy

source_score = clamp(base - penalty, 0, 1)
```

Freeze these initial weights as `source-rank-0.1.0`, label a golden set, evaluate, then tune. Missing features use a source-class prior plus an explicit missingness indicator; they never silently become zero.

### 3.2 Authority is claim-relative

- API behavior: versioned official docs and repository source/tests.
- Algorithm origin/result: paper and accompanying artifacts.
- Production adoption: detailed operator case study.
- Standard semantics: standards-body specification.
- Product status/pricing: current official product/changelog/pricing source.

## 4. Multi-channel fusion and diversity

Each channel produces an ordered list. Normalize identities, remove duplicates, and use Reciprocal Rank Fusion:

```text
rrf(candidate) = sum over channels [1 / (60 + rank_channel(candidate))]
```

Rerank the top 100 with the deterministic purpose-specific score. Apply maximal marginal relevance:

```text
candidate_relevance = 0.25 * normalized_rrf + 0.75 * source_score
mmr(c) = lambda * relevance(c) - (1 - lambda) * max_similarity(c, selected)
```

Start `lambda = 0.75`. Enforce source-class and domain quotas after MMR. A learned/pairwise reranker may later replace second-stage ordering, never eligibility, provenance, or authority gates.

## 5. Evidence and entity-frontier scores

Evidence is scored separately from its containing source:

```text
evidence_score =
  0.30 * claim_directness
  0.25 * anchor_integrity
  0.20 * source_authority_for_claim
  0.15 * temporal_alignment
  0.10 * independent_corroboration
  - 0.15 * unresolved_conflict
  - 0.10 * version_ambiguity
```

Entity-frontier priority decides what to follow or expand, not what is true:

```text
entity_frontier =
  0.24 * domain_value
  0.20 * expected_information_gain
  0.16 * curriculum_leverage
  0.14 * dependency_or_lineage_centrality
  0.10 * change_velocity
  0.08 * credible_attention_signal
  0.08 * diversity_bonus
  - 0.12 * saturation
  - 0.08 * identity_ambiguity
```

`credible_attention_signal` may use citations, adoption, releases, talks, or maintainer activity to find candidates. It never raises evidence authority.

## 6. Domain priority

Compute one immutable snapshot per domain and campaign:

```text
domain_value =
  0.22 * curriculum_demand
  0.18 * coverage_gap
  0.14 * frontier_velocity
  0.13 * prerequisite_centrality
  0.12 * project_leverage
  0.08 * production_importance
  0.06 * evidence_availability
  0.07 * uncertainty_reduction_value
  - 0.10 * saturation
  - 0.08 * expected_research_cost
```

- `curriculum_demand`: importance in target project capabilities and learner queries.
- `coverage_gap`: important concepts/source classes without sufficient accepted evidence.
- `frontier_velocity`: meaningful releases, papers, standards, or practice changes per window.
- `prerequisite_centrality`: downstream capabilities blocked by this domain.
- `project_leverage`: applicability across production projects.
- `production_importance`: reliability, security, evaluation, deployment, and operations value.
- `evidence_availability`: likelihood bounded research reaches authoritative evidence.
- `uncertainty_reduction_value`: expected decision improvement from another job.
- `saturation`: diverse high-quality coverage already present.
- `expected_research_cost`: searches, fetches, calls, review, and wall time.

Select by portfolio constraints so agents/coding topics cannot crowd out data, inference, evaluation, security, and operations.

## 7. Research-job priority

```text
job_priority =
  0.26 * domain_value
  0.22 * best_source_score
  0.20 * expected_information_gain
  0.12 * temporal_urgency
  0.10 * curriculum_leverage
  0.10 * diversity_bonus
  - 0.10 * normalized_cost
  - 0.10 * policy_or_review_risk
```

Information gain is high when a job resolves a high-impact conflict, fills a prerequisite gap, establishes an alternative/trade-off, verifies a fast-changing claim, or connects isolated graph regions.

## 8. Reranking evolution

1. **v0 heuristic:** deterministic rules and weights; fully explainable.
2. **v1 pairwise reranker:** human preference pairs, while retaining hard gates and feature logging.
3. **v2 contextual policy:** choose among approved policies via offline evaluation or a constrained bandit. No online learning until rewards and protected gates are reliable.

The reranker never sees hidden labels during generation. The optimized component cannot modify its evaluator, source policy, or promotion thresholds.

## 9. Evaluation datasets

| Dataset | Initial size | Labels |
| --- | ---: | --- |
| talk categorization | 50 stratified talks | categories, difficulty, lifecycle, uncertainty |
| source purpose ranking | 60 questions × 15 candidates | 0–3 relevance, authority fit, sufficiency, disqualifiers |
| entity resolution | 200 pairs/sets | same, related, ambiguous, different; rationale |
| domain prioritization | 30 campaign snapshots | ordered portfolio and quota exceptions |
| curriculum signals | 100 claims/signals | prerequisite, outcome, challenge, production value |
| temporal refresh | 100 old/new pairs | valid, changed, superseded, uncertain |
| adversarial sources | 100 items | spam, injection, copied docs, fake repo, stale API, marketing |

Split by event edition, source domain, and time. Keep a hidden temporal set so near-duplicate talks cannot inflate performance.

## 10. Metrics and promotion gates

Ranking:

- NDCG@5/@10, Recall@20, pairwise accuracy, Kendall correlation, and reciprocal rank of the first sufficient authoritative source;
- alpha-NDCG/subtopic recall, domain/source-class exposure, and duplicate rate.

Trust:

- unsupported assertion rate, anchor validity, authority violations, entity false/missed merges, confidence calibration, stale-claim recall, and conflict preservation.

System:

- contract/idempotency/recovery pass rate; cost, latency, searches, bytes, and tokens per accepted source/claim; review/disagreement rate; curriculum coverage gain.

Initial gates:

- no regression on authority, unsupported claims, false merges, idempotency, or security;
- NDCG@10 improvement ≥ 0.03, or material cost reduction, with bootstrap 95% interval above zero;
- no protected domain loses more than 5% recall;
- reviewer acceptance ≥ 80% on changed decisions;
- shadow run before canary.

## 11. Per-run feedback event

After every run emit `research_episode_completed` with immutable inputs, code/policy versions, feature/ranking snapshots, tool events, artifacts, costs, validations, and terminal state. Then:

1. run contract/security/idempotency checks;
2. score eval cases assigned before the run;
3. attribute failures to acquisition, extraction, identity, ontology, ranking, synthesis, or runtime;
4. update drift and coverage aggregates;
5. create an improvement proposal only when a trigger fires.

Triggers include a hard-gate failure, repeated cluster, meaningful regression, high-cost outlier, coverage gap, or scheduled batch review. Every successful episode is evaluated and recorded; it does not automatically justify code churn.

## 12. Reference metrics

- [Reciprocal Rank Fusion paper](https://dl.acm.org/doi/10.1145/1571941.1572114)
- [NDCG off-policy analysis](https://dl.acm.org/doi/10.1145/3637528.3671687)
