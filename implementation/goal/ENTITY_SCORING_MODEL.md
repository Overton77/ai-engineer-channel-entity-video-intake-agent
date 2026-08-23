# Entity scoring and ranking model

**Status:** proposed policy `entity-rank-0.1.0`  
**Scope:** engineers, organizations, software products, libraries, GitHub repositories, papers, and talks/videos/reports  
**Companion policy:** `SOURCE_RANKING_AND_EVALUATION_SPEC.md`  
**Core rule:** observed popularity is a discovery signal; it is neither truth, authority, quality, nor curriculum value.

## 1. Decision

Do not store one universal entity score. Store immutable observations and normalized features, then calculate a **scorecard** for an explicit purpose, audience, date, and cohort. The same library may rank highly for current production adoption, moderately for teaching fundamentals, and poorly as evidence for a scientific claim.

The system therefore has four layers:

1. **Evidence layer:** raw metric observations, source, locator, collection time, effective time, method, scope, and uncertainty.
2. **Feature layer:** entity-type-specific signals normalized within comparable cohorts.
3. **Quality/confidence layer:** coverage, source reliability, identity certainty, freshness, and manipulation risk.
4. **Decision layer:** versioned, purpose-specific scorecards followed by diversity-constrained selection.

Ranking outputs are reproducible decision records. Every result stores `policy_version`, `taxonomy_version`, `as_of`, `purpose`, `audience`, `cohort_id`, feature vector, missingness vector, uncertainty interval, penalties, propagation contribution, final score, rank, eligibility, and explanation codes.

## 2. What a score can and cannot mean

The system distinguishes six latent dimensions. They must remain separately inspectable even when a purpose combines them.

| Dimension | Question answered | Examples of signals |
| --- | --- | --- |
| `attention` | Is the field currently noticing it? | views, mentions, stars, followers, search/social velocity |
| `adoption` | Is it being used or depended upon? | package downloads, dependents, integrations, contributor breadth, production case studies |
| `authority` | Is it an appropriate first-hand or normative source? | authorship, maintainership, official ownership, standards role, primary paper |
| `quality` | Is it technically sound and maintained? | releases, issue responsiveness, reproducibility, security posture, corrections, documentation |
| `influence` | Did it shape downstream work? | citations, derivative repositories, dependencies, implementations, concept lineage |
| `learning_value` | Will researching/teaching it improve capability? | prerequisite centrality, concept coverage, lab feasibility, production relevance, misconception leverage |

`authority` is always claim-relative. A maintainer is authoritative about a release, a paper about its reported method, and a standards body about normative semantics. None is automatically authoritative about independent production efficacy.

## 3. Observation and provenance contract

### 3.1 Metric observation

```ts
interface MetricObservation {
  observation_id: string;
  entity_id: string;
  metric_key: string;             // e.g. github.repo.stars_total
  value: number | string | boolean;
  unit: string;
  scope: Record<string, string>;  // repo, package manager, edition, version, geography
  source_class: string;           // official_api, registry, primary_artifact, secondary_index
  source_locator: string;
  collector: string;
  collection_method: string;
  observed_at: string;
  effective_at?: string;
  window_start?: string;
  window_end?: string;
  raw_artifact_digest?: string;
  source_record_id?: string;
  identity_resolution_id: string;
  source_reliability: number;     // calibrated [0,1], not hand-waved authority
  measurement_error?: number;
  terms_or_access_note?: string;
}
```

Never overwrite observations. Corrections append a superseding record. Derived features retain the observation IDs and transformation version that produced them. Secrets, access tokens, and raw private profile data are never persisted in score explanations.

### 3.2 Feature record

```ts
interface EntityFeature {
  snapshot_id: string;
  entity_id: string;
  as_of: string;
  feature_key: string;
  raw_value?: number;
  transformed_value: number;       // [0,1]
  posterior_mean: number;          // after reliability/missingness shrinkage
  posterior_sd: number;
  cohort_id: string;
  transform_version: string;
  observation_ids: string[];
  missingness: "observed" | "structural" | "unavailable" | "not_collected" | "stale";
  manipulation_risk: number;
}
```

### 3.3 Evidence grades

Use source-class priors that are subsequently calibrated against reconciliation audits:

- **A:** official API/registry, signed release, repository history, paper body, standards artifact;
- **B:** established index that documents its metric and identity mapping;
- **C:** independently corroborated secondary measurement;
- **D:** self-reported or promotional claim;
- **E:** inferred/uncorroborated mention, used only for discovery.

A grade is not a truth label. It controls measurement confidence and eligibility for particular features.

## 4. Entity-specific feature families

All features below are candidates, not mandatory fields. Initial production policies should use only metrics with reliable acquisition and a documented interpretation.

### 4.1 Engineers and researchers

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Authorship/creation | accepted papers; fractional citations; repositories/products originated; patents where relevant | Fractionalize by author count and role when known; do not infer contribution from author order across fields |
| Maintainer stewardship | active maintainer roles; merged reviews; release responsibility; issue response; tenure | Prefer repository evidence to biography claims; distinguish current from historical roles |
| Engineering impact | downstream dependents of maintained work; independently verified production case studies; implemented proposals | Cap inherited product/repo influence; require an evidenced relationship |
| Knowledge contribution | substantive talks, tutorials, reports, documentation; concept coverage; pedagogical clarity | Views measure reach, not correctness; score artifact quality separately |
| Research influence | field-normalized citations; influential-citation indicators if available; replication/implementation links | Cohort by field and publication age; exclude self-citations in a sensitivity view |
| Community contribution | contributor mentorship/breadth; standards participation; constructive review; open artifacts | Avoid opaque social prestige proxies and protected attributes |
| Current activity | meaningful releases, papers, talks, reviews in rolling windows | Use role-specific decay; career gaps must not become quality penalties |
| Attention | verified followers, qualified mentions, post engagement velocity | Optional discovery-only channel; bot/manipulation adjusted; never required for eligibility |

Never compute a human “worth” score. Rank a person only for a declared function such as `maintainer_to_research`, `authoritative_source_for_topic`, or `educator_for_audience`.

### 4.2 Organizations

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Research output | papers, released models/datasets, artifacts, field-normalized influence | Separate organization at publication time from present affiliation |
| Open-source stewardship | maintained projects, maintainer bus factor, release cadence, community merge share | Count sustained stewardship, not mass-created repositories |
| Product/production footprint | verified customers/case studies, integrations, ecosystem dependents, service availability | Commercial claims require independent or auditable support |
| Standards/ecosystem role | specifications, interoperability, foundation participation, reference implementations | Governance role is not product quality |
| Reliability/trust | incident transparency, security advisories, correction behavior, documentation/versioning | Absence of reported incidents is not proof of reliability |
| Talent/knowledge network | relevant engineers/researchers and retention/stewardship continuity | Use aggregate public professional evidence; do not score sensitive employment traits |
| Attention/momentum | qualified mentions, hiring/project/release velocity | Discovery signal; normalize for organization size and media intensity |

### 4.3 Organization software products

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Capability fit | supported tasks/modalities, context/latency/cost limits, interoperability | Version- and plan-specific; claims need current official evidence |
| Adoption | integrations, SDK/package activity, verified customer evidence, community artifacts | Do not equate vendor account creation with active use |
| Performance | independent task-relevant evaluations, reproducibility, robustness | Never collapse heterogeneous benchmarks into an unqualified average |
| Operability | uptime history, observability, quotas, deployment options, migration/version policy | Store geography/tier/date scope |
| Safety/security | published controls, incident response, data handling, relevant certifications | Certification presence and technical efficacy are different features |
| Economics | normalized cost per workload, rate-limit headroom, switching cost | Scenario-specific; prices expire quickly |
| Developer experience | docs completeness, time-to-first-success, SDK coverage, issue/support response | Prefer sampled task evaluations over sentiment alone |
| Momentum | releases, capability changes, new integrations, qualified attention | High velocity can also imply churn; pair with stability |

### 4.4 Libraries and frameworks

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Adoption | registry downloads (unique/ecosystem-adjusted where possible), direct/transitive dependents, imports in sampled public code | Downloads include CI, mirrors, bots, and transitive installs; compare within registry/ecosystem |
| Maintenance | release recency/cadence, supported-version breadth, issue/PR response, active maintainer count | Activity volume alone can reward instability |
| Community health | unique contributors, newcomer retention, non-core merge share, concentration/bus factor | Use rolling windows and bot filtering |
| Technical quality | test/release automation, typed APIs, documentation, reproducible examples, compatibility | Presence metrics are weak; sample quality where feasible |
| Reliability/security | advisories and response time, signed/provenanced releases, dependency risk, breaking-change discipline | More disclosed advisories can reflect better transparency; score response separately from count |
| Ecosystem position | integrations, alternatives, complementarity, dependency centrality | Centrality is capped and never treated as evidence quality |
| Curriculum leverage | concept clarity, lab feasibility, transferability, production patterns/failure modes | A widely adopted abstraction can still be poor for teaching fundamentals |
| Momentum/stability | adoption velocity, release velocity, churn, deprecation rate | Reward credible growth and stable stewardship, not raw acceleration alone |

### 4.5 GitHub repositories

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Attention | stars, forks, watchers, unique qualified referrers when legitimately available | Stars are stock variables with bot/campaign and age bias |
| Use/derivation | dependent repositories/packages, forks with substantive divergence, clones only if owner-authorized | Raw forks and clones often do not imply use |
| Development | meaningful commits, merged PRs, unique active contributors, release/tag cadence | Exclude bots, formatting-only bursts, generated/vendor code where detectable |
| Responsiveness | issue/PR first response, merge/close time, stale backlog by severity | Cohort by project size and governance style |
| Sustainability | maintainer concentration, contributor retention, funding/governance visibility, ownership continuity | Small focused projects should not be punished simply for being small |
| Quality/reproducibility | CI, tests, release provenance, examples, docs, reproducible build, benchmark artifacts | Evaluate sampled artifacts, not badges alone |
| Security/supply chain | advisories, remediation latency, branch protection attestations when public, signed releases, dependency exposure | Do not infer absent private controls |
| Relevance | topic/task fit, implementation completeness, version compatibility | Query-relative rather than global |

### 4.6 Papers

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Scientific influence | field/year-normalized citations, citation velocity, influential/independent citations, downstream methods | Counts lag and differ radically by field; preserve index and query date |
| Novelty/lineage | introduced concepts/methods/datasets; position in citation/concept graph | LLM novelty judgments require evidence and review |
| Rigor | method clarity, baselines, uncertainty, ablations, limitations, statistical appropriateness | Human/evaluator rubric with calibrated agreement, not popularity |
| Reproducibility | code/data/weights, executable artifact, independent replications, result reproduction status | “Code available” is not “results reproduced” |
| Practical transfer | implementations, library adoption, verified production use, cost/compute disclosure | Graph links must be evidenced and time-scoped |
| Currency/status | version, venue/review status, corrections/retractions, superseding work | Preprints are eligible but clearly labeled; retractions trigger a gate |
| Curriculum leverage | prerequisite/foundational value, explanatory quality, lab potential, misconception resolution | Seminal and current-state readings are separate slots |
| Attention | saves, discussion, media/social mentions | Discovery-only and manipulation adjusted |

### 4.7 Talks, videos, and reports

| Family | Candidate metrics | Interpretation and cautions |
| --- | --- | --- |
| Reach | views/reads/downloads, qualified engagement, completion where legitimately available | Platform-, age-, promotion-, and autoplay-normalized |
| Authority fit | speaker/author relationship to claims; primary implementation or incident role | Fame is not authority; verify identity and role at publication time |
| Evidence density | inspectable demonstrations, methods, citations, benchmarks, architecture details | Transcript-grounded rubric with anchors |
| Technical depth | mechanism, trade-offs, failure modes, production detail | Audience-relative |
| Novelty | information not duplicated by official docs/papers; first disclosure | Preserve source lineage and publication date |
| Pedagogical value | structure, prerequisite clarity, examples, misconceptions, lab/challenge extractability | A separate evaluator rubric, not view count |
| Durability/currency | claims still valid, version specificity, update/supersession status | Fast decay for API/product details; slow decay for fundamentals |
| Reception | citations/backlinks, expert discussion, derivative tutorials | Sentiment is optional and must not substitute for evidence |

## 5. Normalization and cohorting

Raw counts are never directly compared across entity types, platforms, fields, or ages.

### 5.1 Transform heavy-tailed metrics

For non-negative counts, use a documented monotonic transform before cohorting:

```text
y = log1p(x)
```

For rates use an exposure-aware estimator. Example: merged PR share with `m` successes from `n` eligible PRs uses a beta-binomial posterior rather than `m/n`, so tiny projects do not jump to 100%.

### 5.2 Define comparable cohorts

Each feature declares cohort keys. Examples:

- repository stars: host × primary ecosystem/topic × age band × archive status;
- package downloads: registry × package role (`direct_tool`, `runtime_dependency`, `types`, `meta_package`) × age band;
- paper citations: field/topic × publication year × artifact type;
- talk reach: platform × format/duration × publication quarter × event channel size;
- engineer output: role/topic × career-stage exposure window, only where ethically and reliably inferable;
- product economics: workload scenario × region × pricing period.

Use the narrowest cohort with at least `N_min` reliable members (initially 200). Back off through a declared hierarchy when sparse. Record the chosen cohort.

### 5.3 Robust percentile normalization

Initial implementation uses a winsorized empirical CDF:

```text
z_i = (rank_mid(y_i within cohort) - 0.5) / N
z_i in (0,1)
```

Winsorize only for parametric summaries; preserve the raw count. Percentiles are interpretable and robust to heavy tails but compress the extreme top. Where magnitude matters, blend percentile and robust magnitude:

```text
robust_z = clamp(0.5 + (y - median(y)) / (6 * MAD(y)), 0, 1)
normalized = 0.75 * ECDF(y) + 0.25 * robust_z
```

### 5.4 Opportunity/exposure correction

When a metric depends on exposure, model expected value first:

```text
expected_attention = f(age, platform, topic, channel_size, promotion_exposure)
residual_attention = log1p(actual) - log1p(expected)
```

Rank the residual within its cohort. Exposure correction prevents old repositories, large conference channels, or already-famous people from winning solely because they had more opportunity to accumulate counts.

## 6. Time, decay, momentum, and stability

### 6.1 Metric-specific decay

For an event observation of age `a` days:

```text
decayed_value = value * exp(-ln(2) * a / half_life)
```

Half-life belongs to the metric and decision purpose, not the entity. Initial examples:

| Signal | Example half-life |
| --- | ---: |
| social/post attention | 14–30 days |
| product/API state and price | 30–90 days |
| repository activity/release | 90–180 days |
| package adoption flow | 180 days |
| maintainer stewardship | 365 days |
| paper citation flow | 730 days |
| foundational/lineage status | no automatic decay; reevaluate supersession |

Stock metrics such as total stars or total citations do not simply decay. Represent them as `stock_percentile`, plus decayed flows and velocity.

### 6.2 Velocity and acceleration

Use robust, comparable windows and avoid percentage growth from tiny bases:

```text
velocity = (log1p(flow_0_30d) - log1p(flow_31_60d)) / 30
acceleration = velocity_recent - velocity_prior
```

Normalize these within cohorts. Apply empirical-Bayes shrinkage toward the cohort mean based on exposure/count. Require a minimum history before emitting acceleration.

### 6.3 Momentum must include stability

```text
momentum = 0.55 * velocity_pct
         + 0.20 * acceleration_pct
         + 0.25 * breadth_of_growth
         - 0.25 * anomaly_risk
         - 0.15 * churn_or_breakage
```

`breadth_of_growth` asks whether growth appears across independent channels (downloads, contributors, dependents, citations) instead of a single viral counter.

## 7. Missingness, confidence, and uncertainty

Missing is not zero. Classify it as structural, unavailable, not collected, stale, or unexpectedly absent.

For feature `j`, estimate a cohort prior `Beta(alpha_j, beta_j)` or an equivalent hierarchical distribution. An observed normalized value `z` with effective evidence strength `n_eff` yields:

```text
posterior_mean_j = (alpha_j + n_eff * z) / (alpha_j + beta_j + n_eff)
n_eff = n0 * source_reliability * freshness * identity_confidence * (1 - manipulation_risk)
```

Missing features use the cohort prior mean and retain high posterior variance. They cannot quietly improve a rank: selection uses a risk-adjusted score when confidence matters.

```text
point_score = sum_j w_j * posterior_mean_j - penalties
score_sd ~= sqrt(w' * covariance * w)
conservative_score = point_score - lambda_risk * score_sd
```

Initial `lambda_risk`: `0.0` for exploratory discovery, `0.5` for research allocation, and `1.0` for automatic curriculum recommendations. Report a 90% interval from bootstrap/posterior samples.

Score confidence is distinct from score magnitude:

```text
confidence = geometric_mean(
  required_feature_coverage,
  weighted_source_reliability,
  identity_confidence,
  temporal_freshness,
  cross_source_agreement
) * (1 - manipulation_risk)
```

Do not multiply every final score by confidence; that systematically buries new entities. Show both, and use the conservative score or an explicit confidence gate for high-stakes decisions.

## 8. Anti-gaming and metric integrity

### 8.1 Controls

- Prefer independently generated behavior (dependents, sustained contributors, citations from unrelated teams) over cheap counters.
- Detect bursts, round-number campaigns, follower/star account quality anomalies, repeated synchronized events, bot identities, fork farms, citation rings, and download/CI amplification.
- Weight unique, aged, independently active actors more than raw events where platform terms and data allow.
- Cap any single platform or feature family at 25% of a decision score.
- Require corroboration across at least two independent signal families for a `momentum` label.
- Maintain self-citation, same-organization citation/dependency, and vendor-claimed benchmark sensitivity views.
- Separate disclosure quality from incident/advisory count so transparent projects are not punished.
- Treat unexplained counter discontinuities as uncertain observations, not genuine growth.
- Freeze score snapshots before evaluation; prohibit a generation agent from changing its own scoring policy.

### 8.2 Anomaly penalty

```text
manipulation_risk = calibrated_model_or_rules(
  burstiness, actor_quality, concentration, synchrony,
  cross_channel_disagreement, known_campaign, counter_discontinuity
)

integrity_adjusted_feature = prior_mean
  + (observed_feature - prior_mean) * (1 - manipulation_risk)
```

High risk shrinks a feature toward its cohort prior; it does not assert fraud. Severe cases become review tasks and retain the raw evidence.

## 9. Cross-entity propagation without prestige collapse

Graph relationships allow useful influence to travel: a paper implemented by several libraries has practical influence; an engineer maintaining a widely used library has stewardship impact. Naive PageRank would amplify already-popular hubs and transfer reputation indiscriminately. Use typed, bounded, residual propagation instead.

### 9.1 Eligible typed edges

Each edge must have evidence, time, direction, role, and confidence. Examples:

- engineer `AUTHORED` paper: research influence, fractionalized by author/contribution role;
- engineer `MAINTAINS` library/repo: stewardship, time-decayed and share-capped;
- organization `STEWARDS` product/library: ecosystem impact, not inherited technical quality;
- repo `IMPLEMENTS` paper: practical transfer to the paper; relevance from paper to repo, not automatic repo quality;
- library `DEPENDS_ON` library: adoption evidence, deduplicated at organization/project-family level;
- talk `EXPLAINS` concept/product: pedagogical/reach signal, not claim authority unless role fits.

### 9.2 Propagate only residual evidence

First score direct evidence. Then propagate the neighbor's **cohort-centered residual**, not its full score:

```text
residual(v, d) = direct_score(v, d) - cohort_prior(v.type, d)

incoming(u, d) = sum over eligible v->u [
  edge_type_weight * edge_confidence * role_share * time_decay
  * tanh(residual(v, compatible_dimension) / temperature)
] / sqrt(max(1, eligible_degree(u)))

propagated(u, d) = clamp(incoming(u, d), -prop_cap, prop_cap)
final_dimension(u, d) = clamp(direct_score(u, d) + propagated(u, d), 0, 1)
```

Initial `prop_cap = 0.10`; cross-type propagation contributes at most 10 percentage points to a dimension and at most 15% of any purpose score. Run one hop in v0. Multi-hop propagation requires offline evidence that it improves judgment without reducing new/underrepresented-entity recall.

### 9.3 Rich-get-richer safeguards

- Degree discount and per-neighbor caps.
- Deduplicate related neighbors by organization, repository family, citation community, and package family.
- Exclude self-loops and downweight same-organization edges in influence views.
- Propagate only between compatible dimensions; attention never propagates into authority or quality.
- Maintain a `direct_only_score` beside the final score.
- Allocate exploration slots to high-uncertainty and low-exposure candidates.
- Audit exposure by age band, geography/language where legitimately known, organization size, and discovery channel; never infer protected attributes for ranking.

## 10. Purpose-specific scorecards

Feature families are normalized dimensions on `[0,1]`. Purpose policies declare weights, gates, penalties, risk posture, and diversity constraints.

### 10.1 Research-next priority

This chooses what deserves deeper research, not what is best:

```text
research_next =
  0.20 * domain_value
  + 0.18 * expected_information_gain
  + 0.16 * curriculum_leverage
  + 0.12 * credible_adoption
  + 0.10 * influence
  + 0.10 * momentum
  + 0.08 * graph_bridge_value
  + 0.06 * evidence_availability
  - 0.12 * saturation
  - 0.08 * manipulation_risk
  - 0.08 * identity_ambiguity
```

Use `point_score - 0.5 * score_sd`, then add a separately budgeted uncertainty/exploration pool. Information gain can make an uncertain entity valuable; uncertainty must not masquerade as quality.

### 10.2 Curriculum inclusion

```text
curriculum_value =
  0.24 * learning_value
  + 0.18 * production_relevance
  + 0.16 * prerequisite_or_lineage_value
  + 0.14 * evidence_quality
  + 0.12 * lab_or_challenge_feasibility
  + 0.08 * transferability
  + 0.08 * current_adoption
  - 0.12 * vendor_or_tool_lock_in
  - 0.10 * likely_obsolescence
```

Eligibility requires sufficient evidence and a teachable reason. Popularity alone cannot cross the gate.

### 10.3 Production technology watchlist

```text
production_watch =
  0.25 * task_fit
  + 0.20 * credible_adoption
  + 0.15 * maintenance_and_operability
  + 0.12 * reliability_security
  + 0.10 * ecosystem_fit
  + 0.10 * momentum
  + 0.08 * evidence_quality
  - 0.12 * switching_or_lock_in_risk
  - 0.10 * instability
```

This is workload-specific. Never publish a context-free “best framework/product” list.

### 10.4 Authority for a claim

Use the companion source/evidence policy. Entity metrics provide role/identity evidence only. Social reach, downloads, stars, commercial adoption, and graph prestige receive zero authority weight.

## 11. Diversity-constrained ranking

Top-N sorting tends to return one fashionable agent framework cluster. Selection is a portfolio problem.

After eligibility and purpose scoring, use constrained maximal marginal relevance:

```text
utility(c | selected) =
  lambda * conservative_score(c)
  - (1 - lambda) * max_similarity(c, selected)
  + coverage_gap_bonus(c)
  + exploration_bonus(c)
```

Start `lambda = 0.75`. Similarity combines taxonomy overlap, embedding similarity, shared organization, dependency/citation community, and artifact duplication. Configure campaign constraints such as:

- minimum coverage across lifecycle stages: data, model/inference, orchestration, evaluation, security, deployment/operations, and product/UX;
- maximum 20% from one organization and 25% from one ecosystem family;
- minimum representation of foundational, production-proven, frontier, alternative/contrarian, and failure-analysis artifacts;
- reserve 10% for high-information-gain candidates outside dominant graph communities;
- reserve explicit verification slots for conflicts and weakly evidenced high-attention entities.

If constraints cannot be met, return the infeasibility reason rather than silently relaxing them.

## 12. Worked example

Suppose a campaign asks: **Which agent orchestration library should receive a deep-research job for an intermediate production curriculum?** Two age- and ecosystem-cohorted libraries have these posterior features:

| Feature | Weight | Library Atlas | Library Beacon |
| --- | ---: | ---: | ---: |
| domain value | 0.20 | 0.82 | 0.76 |
| expected information gain | 0.18 | 0.42 | 0.83 |
| curriculum leverage | 0.16 | 0.78 | 0.74 |
| credible adoption | 0.12 | 0.94 | 0.62 |
| influence | 0.10 | 0.88 | 0.58 |
| momentum | 0.10 | 0.31 | 0.86 |
| graph bridge value | 0.08 | 0.40 | 0.77 |
| evidence availability | 0.06 | 0.91 | 0.68 |
| saturation penalty | 0.12 | 0.85 | 0.18 |
| manipulation penalty | 0.08 | 0.05 | 0.08 |
| identity ambiguity penalty | 0.08 | 0.00 | 0.00 |

Direct calculation:

```text
Atlas positive = .20(.82)+.18(.42)+.16(.78)+.12(.94)+.10(.88)
               + .10(.31)+.08(.40)+.06(.91) = 0.6828
Atlas penalties = .12(.85)+.08(.05) = 0.1060
Atlas point = 0.5768

Beacon positive = .20(.76)+.18(.83)+.16(.74)+.12(.62)+.10(.58)
                + .10(.86)+.08(.77)+.06(.68) = 0.7406
Beacon penalties = .12(.18)+.08(.08) = 0.0280
Beacon point = 0.7126
```

Atlas has far more stars, downloads, and graph prestige, but is already saturated in the knowledge base. Beacon has stronger current velocity, bridges a missing architecture community, and promises more information gain. If posterior standard deviations are `0.04` and `0.10`, respectively:

```text
Atlas conservative = .5768 - .5(.04) = .5568
Beacon conservative = .7126 - .5(.10) = .6626
```

Beacon remains the better **research-next** choice. This does not mean it is the better production library. A production-watch policy could still rank Atlas first because adoption, operability, and stability receive more weight.

Now suppose Beacon was implemented from Paper P and its maintainers authored Talk T. One-hop typed propagation adds `+0.03` practical-transfer residual to Paper P and `+0.02` stewardship evidence to the maintainers. It does **not** transfer Beacon's attention to their authority, and the cap prevents Beacon's momentum from dominating other entity types.

The emitted explanation should say:

> Selected Beacon for deep research because its information gain, recent cross-channel momentum, and bridge value outweighed Atlas's higher adoption. Confidence is moderate due to a shorter history. Atlas was penalized for existing coverage, not for technical weakness.

## 13. Storage and API outputs

Minimum logical tables:

- `metric_observation`
- `metric_reconciliation` (conflicts and supersession)
- `feature_definition`
- `feature_snapshot`
- `cohort_definition`
- `entity_dimension_snapshot`
- `relationship_evidence`
- `propagation_snapshot`
- `ranking_policy`
- `ranking_snapshot`
- `selection_snapshot`
- `ranking_explanation`

Recommended response contract:

```json
{
  "entity_id": "library:beacon",
  "purpose": "research_next",
  "as_of": "2026-08-22T00:00:00Z",
  "policy_version": "entity-rank-0.1.0",
  "taxonomy_version": "taxonomy-1.1.0",
  "cohort_ids": ["github:agent-framework:age-1-2y", "pypi:orchestration"],
  "point_score": 0.7126,
  "conservative_score": 0.6626,
  "confidence": 0.67,
  "interval_90": [0.54, 0.86],
  "direct_only_score": 0.7001,
  "propagation_contribution": 0.0125,
  "feature_contributions": {},
  "missing_features": ["verified_production_case_studies"],
  "penalties": {"saturation": 0.0216, "manipulation_risk": 0.0064},
  "explanation_codes": ["HIGH_INFORMATION_GAIN", "CROSS_CHANNEL_MOMENTUM", "BRIDGES_COVERAGE_GAP"],
  "observation_ids": ["obs_..."],
  "eligible": true
}
```

## 14. Evaluation and governance

### 14.1 Offline evaluation

Build stratified, time-sliced judgments for each purpose. Evaluate:

- NDCG@10, pairwise accuracy, Kendall correlation, Recall@20;
- alpha-NDCG/subtopic recall, organization/ecosystem concentration, and graph-community coverage;
- calibration of 50%/90% intervals and Brier score for threshold decisions;
- new-entity recall, age-band exposure, low-degree-node recall, and rank change with propagation disabled;
- sensitivity to removal of stars, followers, citations, downloads, self-links, and same-organization links;
- stability under metric refresh and resistance to simulated counter inflation;
- reviewer acceptance and explanation correctness.

### 14.2 Promotion gates

A ranking policy may advance only when:

- authority/popularity separation has no violations;
- ranking quality improves or cost materially decreases with bootstrap confidence;
- no protected domain or lifecycle category loses more than 5% recall;
- new/low-degree entity recall does not regress materially;
- propagation adds measurable value and stays within caps;
- manipulation simulations cannot move a candidate across an automatic-selection threshold using one cheap signal;
- all selected items can be reconstructed from provenance.

### 14.3 Human review triggers

Require review for ambiguous identities; score-threshold decisions with low confidence; sharp unexplained velocity; retractions/security events; conflicts between official and independent evidence; high-attention entities with weak authority; and any policy/ontology change.

## 15. Implementation sequence

1. Implement immutable observations and identity/provenance requirements.
2. Add a small metric registry with 10–15 reliable features: repository history, releases, contributors, package downloads/dependents, paper citations/versions, artifact links, and talk metadata.
3. Produce cohort snapshots and robust normalized features; freeze `normalization-0.1.0`.
4. Label 50–100 candidates per purpose and validate deterministic scorecards.
5. Add missingness posteriors, confidence intervals, and conservative ranking.
6. Add MMR and portfolio constraints.
7. Add one-hop typed propagation in shadow mode; promote only after low-degree/new-entity audits.
8. Add social/attention signals last, isolated as optional discovery features with anomaly controls.

The first usable system should be deliberately boring: strong provenance, defensible cohorts, transparent weights, confidence, and diverse portfolios. Learned ranking can later optimize within these boundaries; it must not erase them.
