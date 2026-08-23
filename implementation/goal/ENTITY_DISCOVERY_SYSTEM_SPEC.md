# Progressive AI entity discovery system

**Status:** architecture narrative and implementation specification `0.1.0`  
**As of:** 2026-08-22  
**Purpose:** turn a noisy, fast-moving AI ecosystem into a provenance-preserving research frontier that can later compile deep-research jobs, curricula, and challenges.

## 1. The narrative: what the system actually does

At 06:00 on a Monday, the system wakes to a landscape, not a leaderboard.

It notices that an agent library gained package downloads, three new non-core maintainers, two credible production case studies, and a burst of GitHub stars. The burst alone is cheap attention. The independent maintainer growth and downstream adoption are harder signals. It notices that a less famous competing library has fewer downloads but implements a new durable-execution pattern, bridges a gap in the existing curriculum, and has excellent failure-analysis material. It notices that a foundational paper is still cited, but its API details are stale; a recent maintainer talk explains the operational trade-offs better; the normative protocol specification is the authority for wire behavior.

The system does not ask, “Which one is best?” It asks:

1. Which entities exist, and are these really the same entity?
2. What role does each play in the AI engineering value chain?
3. What has been observed, by whom, through which method, and at what time?
4. Is a signal attention, adoption, authority, quality, influence, or learning value?
5. Which unanswered question would most improve the knowledge graph or curriculum?
6. Which portfolio of research jobs covers foundations, frontier developments, production practice, alternatives, failures, security, and underrepresented branches?

The popular library may win `production_watch`. The emerging competitor may win `research_next`. The paper may win `scientific_lineage`. The specification may win `claim_authority`. The talk may win `pedagogical_explanation`. This is the central design: **one entity can have many defensible ranks because ranking is a decision with a purpose, not an intrinsic property.**

After selection, the system emits bounded deep-research contracts. A downstream researcher receives exact identities, questions, claims to verify, known disagreements, preferred source classes, time bounds, budgets, and acceptance tests. Later, the curriculum compiler sees prerequisites, techniques, production tasks, failure modes, labs, comparisons, and refresh risk—not a bag of popular links.

## 2. Architecture decision

Keep four concerns separate:

```text
canonical identity + temporal relations
                |
                v
append-only metric and evidence observations
                |
                v
cohort-normalized features + uncertainty + integrity controls
                |
                v
purpose-specific ranking + diverse portfolio selection
                |
                v
deep-research job -> accepted claims -> curriculum/challenges
```

Do not write counters directly onto canonical entity rows. Do not let taxonomy labels contain rank. Do not let search-provider relevance become source authority. Do not transfer social prestige through graph edges.

### System records

- `entity`: stable canonical identity.
- `external_identifier`: provider namespace, immutable provider ID, validity interval.
- `entity_alias`: name/handle/locator with validity interval and evidence.
- `relationship_assertion`: typed, directed, time-bounded relation with evidence.
- `metric_observation`: append-only provider observation and raw artifact digest.
- `feature_snapshot`: transformed value, cohort, missingness, posterior uncertainty, manipulation risk.
- `ranking_snapshot`: immutable policy decision, contributions, interval, confidence, explanations.
- `selection_snapshot`: MMR/portfolio result and constraint decisions.
- `research_job`: bounded downstream question and acceptance contract.

The TypeScript contract is in `contracts/entity-ranking.ts`.

## 3. Taxonomy: a stable spine with orthogonal facets

The existing 17-category engineering spine remains the primary topical axis. It is good because it names the engineering decision under study: inference, data, retrieval, agents, tools/protocols, durable orchestration, evals, security, multimodality, product UX, and so forth.

Do not keep growing that enum every time the market invents a phrase. Add versioned orthogonal facets.

### 3.1 Canonical entity kinds

The seven requested families are first-class:

| Requested family | Canonical root | Important subtypes |
| --- | --- | --- |
| Engineers | `person` | engineer, researcher, founder, maintainer, educator, operator, standards contributor, reviewer |
| Organizations | `organization` | company, frontier lab, academic lab, nonprofit, standards body, foundation, cloud/AI unit, community/media |
| Organization products | `software_product` | managed service, platform, application, API, model product, agent product, developer tool |
| Libraries | `software_component` | library, framework, SDK, runtime, CLI, server, adapter, plugin, package |
| GitHub repos | `repository` | canonical source, monorepo, example, benchmark, docs, mirror, fork, archive |
| Papers | `paper` | preprint, peer-reviewed article, workshop paper, technical report, system/model card, standard/specification |
| Talks/videos/reports | `media_artifact` | talk, tutorial, demo, keynote, panel, interview, podcast, slides, report, postmortem |

Add roots required to keep identities honest: `model`, `protocol_or_standard`, `dataset`, `benchmark`, `evaluation_task`, `environment`, `tool_or_connector`, `concept`, `technique`, `architecture_pattern`, `failure_mode`, `security_threat`, `release`, `package`, `event`, `course`, `curriculum_unit`, `challenge`, and `project_blueprint`.

A product, package, and repository are related but not identical. LangGraph the Python package, its JavaScript package, the GitHub monorepo, its managed platform, and its documentation must never collapse into one row with contradictory metrics.

### 3.2 Required facet families

| Facet | Why downstream research/curriculum needs it |
| --- | --- |
| engineering category | identifies the technical decision/failure mode |
| architecture/control regime | separates deterministic code, predefined LLM workflow, model-directed agent, hybrid, multi-agent, human-agent team |
| workflow/agent pattern | prompt chain, router, manager-workers, evaluator-optimizer, plan/execute, tool loop, handoff, blackboard, approval gate |
| capability | retrieval, memory, planning, write action, code execution, verification, permissions, tracing, durable recovery, escalation |
| lifecycle | research, design, implementation, evaluation, deployment, operations, governance |
| release maturity | concept through GA/LTS to deprecated/EOL/archived |
| operational evidence | demo, pilot, named case study, first-party production claim, independently verified production, evidenced scale |
| modality/interaction | text/code/audio/video/screen/sensor; batch/realtime/background/event-driven; IDE/browser/API/robot |
| deployment/runtime | local/edge/cloud/on-prem; container/microVM/sandbox/serverless/durable runtime; state and tenancy |
| governance/risk | autonomy, reversibility, impact, permission scope, oversight, data exposure, concrete agentic threats and controls |
| curriculum role | prerequisite, foundational concept, pattern, implementation, lab, comparison, failure/security case, frontier update |
| assessment role | diagnostic, guided lab, debugging, eval design, red team, incident simulation, comparative experiment, capstone |

Two modern boundaries must be explicit:

- MCP integrates tools/context between hosts, clients, and servers; A2A coordinates agents through capabilities, tasks, messages, status, and artifacts.
- A predefined LLM workflow follows code-defined paths; an agent selects steps/tools dynamically. “Agentic” is not a maturity or quality label.

### 3.3 Temporal relationship vocabulary

Use evidence-backed assertions such as `MAINTAINS`, `AUTHORED`, `PRESENTED`, `OWNED_BY`, `STEWARDED_BY`, `SOURCE_REPOSITORY_FOR`, `PUBLISHED_AS_PACKAGE`, `IMPLEMENTS`, `INTEGRATES_WITH`, `DEPENDS_ON`, `USES_PROTOCOL`, `EVALUATED_BY`, `CITES`, `REPLICATES`, `CONTRADICTS`, `SUPERSEDES`, `ALTERNATIVE_TO`, `PREREQUISITE_FOR`, `TEACHES`, `PRACTICES`, and `ASSESSES`.

Employment, ownership, compatibility, and dependency relations are time/version bounded. `CITES` is not `SUPPORTS_CLAIM`; the latter requires an evidence anchor. Popular co-mention is never a technical edge.

Full definitions and worked classifications are in `TAXONOMY_EXPANSION_RESEARCH.md`.

## 4. What to measure

Six latent dimensions stay inspectable:

| Dimension | Meaning | Representative signals |
| --- | --- | --- |
| attention | current notice/reach | qualified views, stars, followers, mentions, search/social velocity |
| adoption | actual use | direct dependents, registry downloads, integrations, retained users, production cases |
| authority | first-hand/normative role for a claim | maintainer role, authorship, official ownership, standards stewardship |
| quality | soundness/maintenance/operability | tests, releases, issue response, reproducibility, security response, version policy |
| influence | downstream effect | field-normalized citations, derivative work, implementations, dependency reach |
| learning_value | improvement to learner capability | prerequisite centrality, concept clarity, lab feasibility, trade-offs, failure modes |

### Entity-specific metrics

| Entity | High-value metrics | Important traps |
| --- | --- | --- |
| engineer | evidenced maintainer/release roles, accepted/reviewed contributions, fractionalized papers/citations, authored technical artifacts, standards work, current activity | followers and raw commits measure exposure/activity, not skill or worth; career gaps are not penalties |
| organization | research/open artifacts, sustained OSS stewardship, verified production cases, standards role, incident/correction transparency, portfolio health | funding/headcount/mentions measure capacity or attention, not product quality |
| product | task/version fit, independent evaluations, adoption/integrations, uptime/incidents, cost per scenario, data/security controls, DX task tests, change velocity | vendor benchmarks and customer logos require corroboration; pricing is temporal |
| library | registry downloads, direct/transitive dependents, contributors/maintainers, releases, response time, docs/examples, security remediation, compatibility, churn | downloads contain CI/bots/transitive use; high activity may be instability |
| repository | stars/forks/watchers, meaningful commits/PRs, contributor breadth, releases, backlog/response, CI/tests/docs/provenance/security, dependents | stars are age/campaign biased; open issue count includes PRs; traffic is owner-only and short-window |
| paper | field/year normalized citations and velocity, independent/influential citations, rigor, artifacts/replication, implementation links, corrections/retractions, curriculum role | indexes disagree; citations lag; preprints need status; citation count is not rigor |
| talk/video/report | age/platform-normalized reach, authority fit, evidence density/depth, novelty, citations, pedagogical value, validity/supersession | views are promotion/autoplay/channel biased; owner retention analytics are not public-comparable |

## 5. Acquisition strategy

### 5.1 Phase 1: official/open sources

| Source | Entities/signals | Access decision |
| --- | --- | --- |
| GitHub REST/GraphQL | repo/person/org metadata, stars, releases, contributors, activity, community/security; owner-only traffic | use existing token; capture numeric IDs, rate headers, ETags; traffic only with explicit eligible access |
| npm downloads + registry | downloads by window, versions, maintainers, deprecation | public; snapshot; normalize within npm and package role |
| PyPI JSON + BigQuery/pypistats | identity/releases; download estimates from public data | official JSON has no downloads; provenance-label pypistats/BigQuery |
| crates.io/NuGet/Maven/RubyGems/Packagist | ecosystem-specific downloads/dependents/releases | connector per registry; never compare raw counts cross-registry |
| Hugging Face Hub API | model/dataset/space downloads, likes, tags, last modified | public counting rules; not unique users or production deployments |
| OpenAlex | works/authors/institutions/topics, citations, yearly counts, OA, graph expansion | primary open scholarly graph; retain provider ID and query date |
| Crossref/DataCite | DOI identity, deposits, references and link counts, updates | canonical metadata/relations; not complete citation universe |
| Semantic Scholar | paper/author graph, citations, influential-citation model | use key for reliable volume; anonymous probe rate-limited |
| YouTube Data API | video/channel public statistics and metadata | add Google API key; oEmbed resolves identity only |
| HN Firebase, Stack Exchange | community resonance, expert Q&A, temporal discussion | official/open; platform-local cohorts |
| official docs/changelog/status/OSV/SEC | current product claims, releases, incidents, vulnerabilities, filings | Firecrawl/Tavily discover and monitor; canonical page/artifact is evidence |

### 5.2 Discovery layers

- Firecrawl: search, scrape, developer-primary-source search, research-paper search, and later monitoring.
- Tavily: broad candidate discovery with provider relevance score retained only as a retrieval signal.
- xAI/Grok `x_search`: real-time X discovery, semantic/keyword/user/thread retrieval, handle/date filters, and cited synthesis.

Discovery output is not a canonical metric. Resolve its URLs/IDs to the underlying official API or captured artifact before quantitative use.

The configured `XAI_API_KEY` was tested on 2026-08-22 and the xAI API returned `400 Incorrect API key`; the variable is present and syntactically clean, so it needs replacement/activation in the xAI console. Even when fixed, it enables xAI, not X Developer API access. Exact X post/user `public_metrics` require a separately provisioned X API credential/tier.

### 5.3 Licensed or approval-gated enrichment

Similarweb, Crunchbase, G2, Product Hunt, app-store intelligence, funding/company databases, and owner analytics can add value, but each requires a procurement/licensing record. G2 prohibits unlicensed automated scraping. Reddit ingestion needs an approved use case/agreement and deletion/retention design. LinkedIn automation is not an assumed collection path. Missing data is preferable to circumvention.

The detailed API, limits, history, and terms catalog is in `METRIC_SOURCE_CATALOG.md`.

## 6. Observation, normalization, and history

Every number is an immutable observation with entity/provider ID, metric definition, value/unit, scope/window, source locator/class, collection method, observed/effective time, raw artifact hash, identity resolution, reliability, measurement error, access/terms note, and collector version.

History is built by snapshots and events. A provider's current counter is not historical data. Keep stock, flow, velocity, and acceleration separate.

For heavy-tailed non-negative counts:

```text
y = log1p(raw_count)
normalized = 0.75 * ECDF(y within cohort)
           + 0.25 * clamp(0.5 + (y - median) / (6 * MAD), 0, 1)
```

Example cohorts:

- GitHub stars: host × topic/ecosystem × age band × archive state;
- downloads: registry × package role × age band;
- citations: field/topic × publication year × artifact type;
- video reach: platform × format/duration × publication quarter × channel exposure;
- product cost/performance: workload × region × plan/version × date.

Back off to broader declared cohorts when fewer than 200 reliable peers exist. Record the cohort used.

Decay event flows by metric-specific half-life. Social attention may use 14–30 days; API/product state 30–90; repo activity 90–180; package adoption 180; stewardship 365; citation flow 730. Foundational lineage does not automatically decay but can be superseded.

Missing is one of `structural`, `unavailable`, `not_collected`, `stale`, or `observed`; never zero. Shrink noisy values toward cohort priors based on source reliability, freshness, identity confidence, and manipulation risk. Publish point score, uncertainty interval, conservative score, and confidence separately.

## 7. Scoring and ranking

No universal importance score is persisted. Initial purposes:

- `research_next`: expected information gain, curriculum leverage, coverage/bridge value, credible adoption, momentum, evidence availability, minus saturation/risk;
- `curriculum_inclusion`: learning value, production relevance, prerequisite/lineage value, evidence quality, lab feasibility, transferability, adoption, minus lock-in/obsolescence;
- `production_watch`: task fit, credible adoption, maintenance/operability, reliability/security, ecosystem fit, momentum, evidence, minus switching risk/instability;
- `claim_authority`: source/evidence policy only; attention receives zero weight.

Cross-entity propagation is typed, one-hop, residual, and capped. A repository implementing a paper can add practical-transfer evidence to the paper. A person maintaining a library can receive bounded stewardship evidence. Repository attention never becomes personal authority. Cross-type propagation is capped at 10 percentage points per dimension and 15% of a purpose score.

Then select a portfolio with constrained maximal marginal relevance:

```text
utility(candidate) = .75 * conservative_score
                   - .25 * max_similarity_to_selected
                   + coverage_gap_bonus
                   + exploration_bonus
```

Default constraints: no more than 20% from one organization, 25% from one ecosystem family, explicit coverage across lifecycle/security/evaluation/operations, and 10% exploration outside dominant graph communities.

Full formulas, missingness posteriors, anti-gaming controls, worked examples, and evaluation gates are in `ENTITY_SCORING_MODEL.md`.

## 8. Live proof of acquisition

The repository includes `scripts/probe-entity-metrics.mjs`. On 2026-08-22 it successfully collected:

| Probe | Observed example |
| --- | --- |
| GitHub repo | LangGraph: 40,254 stars, 6,777 forks, 285 contributor-count lower bound, 838 commits over GitHub's 52-week participation series; authenticated limit 5,000/hour |
| GitHub person | configured username resolved with numeric platform counters; interpretation explicitly limited |
| npm | `@langchain/langgraph`: 12,763,974 downloads in the returned last-month window |
| PyPI/pypistats | `langgraph`: 71,995,453 last-month derived downloads |
| Hugging Face | Qwen2.5-Coder-7B-Instruct: 2,412,461 30-day downloads and 778 likes |
| OpenAlex | ReAct paper: 578 citations and a year-by-year citation series through 2026 |
| Crossref | AlphaFold Nature DOI: 44,097 `is-referenced-by-count` links; explicitly not interchangeable with other providers |
| YouTube | oEmbed identity resolution succeeded and correctly exposed no engagement metrics |
| Tavily | returned three candidates with provider scores retained as discovery metadata |
| Semantic Scholar | anonymous request returned 429, proving the connector must support a key/backoff and unavailable state |
| xAI X Search | returned 400 for the configured key; credential remediation required |

These are observations at one time, not claims that one entity outranks another. Results are stored in `METRIC_PROBE_RESULTS.json` and `METRIC_PROBE_PAID_AND_FALLBACK_RESULTS.json`.

Run:

```powershell
node scripts/probe-entity-metrics.mjs --out implementation/goal/METRIC_PROBE_RESULTS.json
node scripts/probe-entity-metrics.mjs --include-paid --only xai_x_search
```

The script reads `.env`, never prints credentials, labels caveats beside each metric, and preserves provider failure states rather than converting them to zero.

## 9. Handoff contract to deep research

Each selected item becomes:

```json
{
  "research_job_id": "job_...",
  "campaign_id": "agent-orchestration-2026q3",
  "subject_entity_ids": ["library:pypi:example"],
  "purpose": "research_next",
  "questions": ["Which durable execution guarantees are implemented and at what versions?"],
  "claims_to_verify": ["supports replay-safe human approval"],
  "known_conflicts": [],
  "preferred_source_roles": ["official_documentation", "official_repository", "independent_production_case"],
  "taxonomy_version": "taxonomy-1.1.0",
  "ranking_snapshot_id": "rank_...",
  "as_of": "2026-08-22T00:00:00Z",
  "budgets": {"searches": 12, "fetches": 30, "review_minutes": 20},
  "acceptance_tests": [
    "every factual claim has an evidence anchor",
    "at least one authoritative source and one independent source where available",
    "versions and effective dates are explicit",
    "alternatives and failure modes are represented",
    "curriculum signals include prerequisites and an assessable task"
  ],
  "stop_conditions": ["questions answered with sufficient evidence", "budget exhausted with gaps reported"]
}
```

The curriculum compiler consumes accepted claims, not metric observations directly. Metrics can prioritize research and refresh; they cannot make a claim teachable or true.

## 10. Delivery sequence

1. Adopt the new entity and observation contracts without changing the stable 17-category enum.
2. Implement canonical identity resolution for GitHub numeric IDs, package URLs, DOI/arXiv/OpenAlex/S2 IDs, ORCID/ROR, and video IDs.
3. Productionize 10–15 Phase-1 metrics: GitHub repo/release/contributor activity, package downloads/releases/dependents, OpenAlex/Crossref citations and versions, Hugging Face, YouTube metadata/statistics, official changelogs/status.
4. Start daily snapshots immediately; history cannot be retroactively recovered from many platforms.
5. Freeze cohort transforms as `normalization-0.1.0`; build 50–100 labeled candidates for each ranking purpose.
6. Ship deterministic scorecards with uncertainty, explanation codes, and reconstruction from observations.
7. Add MMR/portfolio constraints, then one-hop graph propagation in shadow mode.
8. Add social attention last and isolate it as optional discovery data.
9. Connect selected scorecards to bounded deep-research job contracts.
10. Promote taxonomy candidates only after three independent examples, retrieval/editorial improvement, a clear parent/definition, duplicate checks, and review.

## 11. Non-negotiable invariants

- Popularity can raise discovery priority; it cannot raise claim authority.
- A provider score never crosses source boundaries without normalization.
- Missing never means zero.
- Entity names are not identities.
- Product, package, repository, model, and organization remain separate nodes.
- Every metric is time-scoped and reproducible from provenance.
- Every ranking names its purpose, cohort, policy, as-of date, uncertainty, and explanation.
- Automated selection is a diverse portfolio, not a sorted hype list.
- Legal/access constraints are eligibility gates, not inconveniences to route around.
- Downstream prose cites evidence anchors, never a ranking score.

## 12. Key current references

- [GitHub REST metrics](https://docs.github.com/en/rest/metrics)
- [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Hugging Face download counting](https://huggingface.co/docs/hub/en/models-download-stats)
- [OpenAlex API](https://docs.openalex.org/)
- [Semantic Scholar Academic Graph API](https://www.semanticscholar.org/product/api)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [xAI X Search](https://docs.x.ai/developers/tools/x-search)
- [X Developer Platform](https://docs.x.com/overview)
- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [OpenAI, A practical guide to building AI agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [Model Context Protocol architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)
- [A2A protocol announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
- [CRediT contributor roles](https://credit.niso.org/)
