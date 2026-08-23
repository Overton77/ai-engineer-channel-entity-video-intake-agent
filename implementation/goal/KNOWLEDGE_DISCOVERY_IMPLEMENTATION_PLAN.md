# Knowledge discovery implementation plan

**Status:** exact implementation sequence; no database or production mutation performed  
**Target:** extend `research_starter_pre_research_agent` without destabilizing pre-research v2

## 1. Constraints

- Keep packet `2.0.0` and the current video pipeline operational while discovery v1 is built.
- Never place Neo4j, Cursor, database, or provider credentials in prompts, skills, child sessions, or sandboxes.
- Models propose typed artifacts; deterministic executors validate and mutate canonical state.
- Postgres is authoritative. Neo4j and retrieval indexes are rebuildable projections.
- Every external side effect is idempotent because Eve can replay an interrupted step.
- Keep existing scheduled processing serial until recovery and rate-limit evidence supports change.
- Cursor changes are isolated candidates, never direct promotion.

## 2. Proposed layout

```text
research_starter_pre_research_agent/
  contracts/
    discovery-campaign.ts source-artifact.ts canonical-entity.ts assertion.ts
    ontology.ts ranking.ts research-job.ts research-episode.ts
  discovery/
    normalize.ts frontier.ts deduplicate.ts entity-resolution.ts portfolio.ts stopping.ts
  ranking/
    source-features.ts source-score.ts reciprocal-rank-fusion.ts diversify.ts
    domain-score.ts job-score.ts explanations.ts
  controller/
    discovery-campaign.ts scheduled-discovery.ts
  executor/
    apply-discovery-intent.ts project-neo4j.ts
  agent/skills/
    campaign-planning/ source-policy/ paper-discovery/
    documentation-repository-research/ entity-resolution/ ontology-proposal/
    ranking-policy/ curriculum-signal-mining/ evaluation-and-optimization/
    cursor-cloud-agent/
  agent/tools/
    search_sources.ts read_source.ts search_papers.ts read_paper.ts
    query_research_registry.ts save_discovery_stage.ts
    score_candidates.ts submit_research_jobs.ts
  evals/discovery/ evals/ranking/ evals/adversarial/
  projections/neo4j/{mapping.ts,cypher.ts,checkpoint.ts}
  optimization/
    episode-ledger.ts failure-attribution.ts proposal-policy.ts cursor-adapter.ts
```

Reuse existing URL normalization, canonical JSON, hashing, stable UUID, artifact storage, Postgres, search ledgers, and receipts. Do not fork their semantics.

## 3. Migration sequence

### A — discovery contracts

Add `research_discovery_campaign`, `research_campaign_seed`, `research_source_locator`, `research_source_observation`, `research_source_artifact`, `research_candidate`, `research_candidate_discovery_path`, `research_ranking_snapshot`, and `research_research_job`.

Require unique normalized locator per namespace, unique artifact digest, unique campaign candidate fingerprint, versioned ranking snapshots, job idempotency/state checks, RLS, and no client writes.

### B — canonical knowledge envelope

Add `research_entity`, `research_entity_external_id`, `research_entity_alias`, `research_assertion`, `research_assertion_evidence`, `research_assertion_review`, `research_ontology_version`, `research_ontology_term`, and `research_ontology_candidate`.

Use typed identity, version, state, confidence, temporal, and provenance columns. Bounded JSON may hold source-class metadata; it cannot replace indexed identity/provenance.

### C — curriculum and monitoring

Add `research_curriculum_signal`, `research_domain_coverage_snapshot`, `research_source_monitor`, and `research_source_change_event`.

### D — episodes and optimization

Add or reuse compatible factory-ledger tables for `research_episode`, events, eval assignments/results, improvement proposals, candidate changes, and promotion receipts.

Do not apply a migration until schema tests, grants/RLS review, rollback/rebuild notes, and fixture migration verification pass.

## 4. Delivery slices

### Slice 0 — freeze and baseline (1–2 days)

Tasks:

1. Build/test the existing agent.
2. Capture a v2 packet fixture and execution receipt.
3. Record backlog, recovery behavior, searches, latency, and cost.
4. Create a 10-talk smoke set and reserve 40 for the golden set.

Accept when build, typecheck, and tests pass; fixture round-trips; no behavior changes.

### Slice 1 — contracts only (2–3 days)

Implement Zod contracts, canonical fingerprints, representative fixtures, and state machines for campaign, candidate, job, ontology proposal, projection, and improvement proposal.

Accept when unknown operations fail closed, reserialization is digest-stable, all mutations bind source/as-of/ontology/policy identity, and illegal transitions fail property tests.

### Slice 2 — source registry and ranking v0 (3–4 days)

Apply Migration A in test only. Implement locator normalization, artifact deduplication, RRF, feature/penalty scoring, MMR, quotas, explanations, and a converter from existing v2 context/organization/verification artifacts. Add fixture import and ranking-audit CLIs.

Accept when repeated import is idempotent, raw provider scores never cross channels, numeric snapshots match goldens, explanations are complete, and duplicates occupy at most one selected slot.

### Slice 3 — campaign vertical slice (4–5 days)

Implement deterministic `controller/discovery-campaign.ts`. Run three World's Fair talks from different categories through seed import, frontier extraction, bounded expansion, resolution proposal, qualification, domain snapshot, and job selection. Save durable stage artifacts and resume from registered checkpoints.

Eve shape:

- application controller owns order, budgets, retries, and cutovers;
- one bounded Eve session per reasoning stage;
- parallel calls/specialists only for independent tasks;
- model-facing `Workflow` is optional adaptive coordination, not deterministic orchestration;
- replace context at durable boundaries as v2 already does.

Accept when crash/retry is stable, budgets are enforced outside the model, all seeds yield an auditable frontier/queue, and malicious page text cannot alter the stage plan.

### Slice 4 — acquisition bundle (3–5 days)

Discover Eve registry integrations first. Implement typed wrappers for web discovery, page extraction, paper search/read, repository/docs search, and event catalogs. Skills choose purpose; tools enforce budgets, policies, schemas, and receipts.

Recommended routing:

- Exa/AI Gateway for broad discovery already used by v2;
- Firecrawl search/scrape/crawl for full-page acquisition and site expansion;
- a primary paper index/reader for scientific evidence;
- Context7 plus canonical docs/repos for API questions;
- official event JSON/MCP and stored transcripts for conference seeds.

Accept when all providers normalize to one observation contract, secrets stay app-side, outages retry without duplicates, and snippets cannot become evidence without artifacts.

### Slice 5 — assertions and Neo4j (4–6 days)

Apply Migration B in test. Implement deterministic entity proposal/merge review, assertion ingestion, projection mapping, checkpointed projection, uniqueness constraints, and blue/green projection switching.

Accept when no model emits arbitrary Cypher, full rebuilds match counts/digests, every edge resolves to an accepted evidenced assertion, ambiguous identities do not auto-merge, and historical assertions support as-of queries.

### Slice 6 — retrieval and curriculum queries (4–6 days)

Define evidence-returning APIs for technology choice, alternatives, prerequisites, production evidence, freshness, and challenge proof. Combine lexical/pgvector candidates, graph expansion, RRF, purpose reranking, temporal filters, and learner/project filters.

Accept when prose cites only returned evidence IDs, lexical recall survives for exact APIs/errors, graph expansion improves prerequisite/alternative recall within budgets, stale claims are marked/filtered, and ranking gates pass.

### Slice 7 — evaluation harness (3–5 days, then continuous)

Materialize the ranking-spec datasets with immutable assignments. Add deterministic assertions, preference labels, calibration, temporal splits, adversarial cases, Eve behavior evals, and exact version/cost/artifact capture.

Accept when assignments precede runs, hidden labels/evaluators are inaccessible to candidates, reports reproduce, and a deliberately degraded source policy fails promotion.

### Slice 8 — per-run optimization and Cursor (4–6 days)

Emit `research_episode_completed` after every terminal run. Evaluate every episode, cluster failures, and apply improvement-trigger policy. Build a server-side Cursor adapter against current official APIs for repository/model listing, launch, run status/stream, artifacts, follow-up, cancel, and archive. Add the `cursor-cloud-agent` skill.

Every launch requires:

- allowlisted repository and exact starting SHA;
- proposal ID and idempotency key;
- branch prefix and no direct main push;
- bounded acceptance criteria and prohibited actions;
- least-privilege MCP set and no production/database credentials;
- cost/time/retry limits;
- required tests, evals, and artifacts;
- cancellation on policy, secret, budget, or repeated-failure signals.

Cursor Automations may handle scheduled repository maintenance only after they pass the same adapter/policy gates. Event-driven launch can be initiated directly by the control plane.

Use the TypeScript SDK as the primary adapter, the HTTP API as the explicit fallback/compatibility contract, and the headless CLI only for local/CI diagnostics or bounded manual jobs. Do not make CLI process lifetime the durable orchestration mechanism.

Accept when the API key is server-only, duplicate events cannot duplicate launches, branches/PRs remain candidates pending independent exact-SHA verification, successful episodes do not cause gratuitous churn, and repeated failures create evidence-linked proposals.

### Slice 9 — monitoring and rollout (ongoing)

Register refresh monitors, deploy an Eve UTC dispatcher schedule backed by database priorities/leases, increase concurrency per job class only from evidence, and progress shadow → canary → catalog expansion.

Accept when overlap/fairness work, changed digests create observations instead of overwrites, dashboards show backlog/coverage/freshness/failures/cost/drift, and rollback restores prior policy/projection pointers.

## 5. Scheduling and concurrency

Use one minute-granularity Eve schedule as dispatcher. Store actual cadence, due time, priority, and lease in Postgres. It acquires an advisory lock, resumes recoverable work first, selects with portfolio-aware fairness, continues a bounded Eve session, records heartbeats/receipts, and releases the lock.

Begin with global concurrency 1 for mutation-bearing campaign controllers and limited parallel read-only acquisition. Raise search, fetch, paper, reasoning, and projection pools independently. Never use model-authored fan-out as the only concurrency control.

## 6. Self-improvement promotion

```text
episode -> evals -> attribution -> improvement proposal
        -> Cursor/Eve candidate branch -> independent tests/review
        -> paired hidden evaluation -> shadow -> human approval
        -> canary -> promotion receipt or rollback
```

Allowed first targets: prompts/skills, queries/routing, ranking weights within bounds, parsers/normalization, tests/observability, and cost/latency optimizations preserving gates.

Forbidden autonomous targets: evaluator labels, hidden cases, authority/security policy, promotion thresholds, credentials, or direct production migration/deployment.

## 7. First executable milestone

Three heterogeneous World's Fair talks must produce:

1. valid unchanged v2 packets;
2. campaign manifest and durable stages;
3. deduplicated source/entity/topic frontier;
4. explainable source/domain rankings;
5. ten deep-research jobs across ≥4 engineering categories and ≥3 source classes;
6. a reproducible small Neo4j assertion projection;
7. five learner technology-choice queries returning cited evidence;
8. a full episode/eval receipt;
9. one induced ranking failure that creates, but does not auto-merge, a Cursor change candidate.

This proves the control loop without pretending the final ontology or curriculum already exists.
