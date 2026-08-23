# Knowledge discovery architecture

**Status:** proposed architecture for review  
**Scope:** source discovery, categorization, entity resolution, ranking, domain prioritization, and the handoff to deep research and curriculum compilation  
**Existing baseline:** pre-research packet `2.0.0`, taxonomy `1.0.0`, Eve `0.38.3`

## 1. Decision

Do not choose between “design the whole schema first” and “let every run invent the schema.” Use a governed middle path:

1. Define the durable envelope before ingestion: source artifact, entity identity, assertion, evidence anchor, provenance, observation time, ontology version, review status, and supersession.
2. Seed a deliberately small ontology from the existing 17 engineering categories, organization domains, stable entity kinds, and stable relationship families.
3. Allow runs to propose aliases, entity subtypes, topic terms, and predicates as data, never as direct schema mutations.
4. Accumulate proposals in an ontology candidate registry and measure frequency, ambiguity, retrieval utility, and reviewer agreement.
5. Promote useful candidates through a reviewed ontology release and reproject accepted assertions into Neo4j under a new projection version.

This gives the research system room to discover the field without letting early conference content permanently define it. Neo4j remains a traversal and retrieval projection, not an unaudited second source of truth.

## 2. System boundary

The existing `research_starter_pre_research_agent` remains the canonical intake and discovery engine. Its current two-session transcript pipeline stays bounded. A discovery-campaign controller is added beside it; it consumes applied v2 packets and expands them into a ranked research frontier.

```text
AI Engineer event/session/transcript seeds
                    |
                    v
existing pre-research v2 intake
  transcript -> taxonomy -> context -> verified packet -> deterministic apply
                    |
                    v
new discovery campaign controller
  normalize -> resolve -> expand -> rank -> diversify -> select next work
           |                    |                    |
           v                    v                    v
   source registry       entity/assertion       domain coverage
           \                    |                    /
            +-------------------+-------------------+
                                v
                     deep-research work queue
                                |
                                v
                 validated research bundles/claims
                                |
             +------------------+------------------+
             v                                     v
   Neo4j projection + retrieval          curriculum signal registry
             |                                     |
             +------------------+------------------+
                                v
                  curriculum/challenge compiler
```

The pre-research agent discovers and prioritizes what deserves deeper work. It must not become the deep-research, graph-ingestion, retrieval-answering, and curriculum-writing system in one prompt.

## 3. Ownership rules

| Concern | Authority | Derived surfaces |
| --- | --- | --- |
| Raw bytes and parsed artifacts | Object storage, content-addressed | chunks, screenshots, transcript views |
| IDs, runs, sources, assertions, reviews, rankings | Postgres/Supabase | reports, queues, metrics |
| Multi-hop entity and prerequisite traversal | Postgres assertions are canonical | Neo4j Aura projection |
| Exact-name and semantic retrieval | canonical chunks and metadata | Postgres FTS + pgvector initially |
| Durable agent execution | Eve on Vercel Workflow | run views and observability |
| Code-improvement candidates | version-controlled repository | Cursor Cloud Agent branch/PR |
| Evaluation and promotion | independent control-plane records | dashboards and optimizer suggestions |

Every Neo4j node carries `canonical_id`, `entity_version`, and `projection_version`. Every projected edge carries `assertion_id`, evidence/provenance IDs, confidence, observed/effective times, and review state. Deleting and rebuilding a projection must be supported.

## 4. Stable core model

### 4.1 Canonical records

- `source_artifact`: immutable fetched or supplied representation identified by content digest.
- `source_locator`: canonical URL/DOI/repository/release/video locator and fetch history.
- `source_observation`: what was observed at a locator at an as-of time.
- `entity`: stable identity for person, organization, product, library, repository, paper, model, protocol, dataset, benchmark, talk, concept, technique, skill, curriculum unit, challenge, or project blueprint.
- `entity_alias`: name, namespace, validity interval, and evidence.
- `assertion`: subject-predicate-object or subject-predicate-typed-literal claim.
- `evidence_anchor`: exact artifact and character/page/time/code-location span supporting an assertion.
- `ontology_term`: versioned category, topic, relationship predicate, or entity subtype.
- `ontology_candidate`: proposed term plus examples and promotion evidence.
- `discovery_campaign`: objective, seed set, source policy, budgets, ontology version, ranking policy, and stopping rules.
- `research_candidate`: source/entity/topic/relationship frontier item produced by a campaign.
- `ranking_snapshot`: immutable feature vector, policy version, score, rank, and selection outcome.
- `research_job`: bounded handoff to the deeper research system.
- `curriculum_signal`: evidence-backed prerequisite, learning outcome, misconception, technique, lab, challenge, or project signal.

### 4.2 Stable relationship families

- ownership and people: `CREATED_BY`, `MAINTAINED_BY`, `WORKS_AT`, `LEADS`
- composition: `PART_OF`, `DEPENDS_ON`, `IMPLEMENTS`, `INTEGRATES_WITH`
- evidence: `INTRODUCED_IN`, `DISCUSSED_IN`, `CITES`, `SUPPORTED_BY`
- evaluation: `EVALUATED_BY`, `BENCHMARKS`, `TRAINED_ON`, `USES_DATASET`
- change: `SUPERSEDES`, `DERIVED_FROM`, `RELEASE_OF`, `CHANGED_BY`
- learning: `PREREQUISITE_FOR`, `TEACHES`, `PRACTICES`, `ASSESSES`
- choice: `ALTERNATIVE_TO`, `COMPLEMENTS`, `RECOMMENDED_FOR`, `CONTRAINDICATED_FOR`

The database stores the assertion and its predicate term. Neo4j projects only accepted predicate versions. An agent may propose a narrow relationship; it may not create that relationship type directly.

## 5. Sequential discovery loop

### Stage 0 — campaign contract

Write a machine-readable manifest with the question and audience, seed rationale, source policy, research as-of date, freshness service levels, ontology and ranking versions, budgets, diversity requirements, stopping conditions, and review gates.

For the first campaign, use the official AI Engineer talk library, event session/speaker JSON, and stored transcripts. Conference talks are excellent frontier seeds but not ground truth: speaker and sponsor selection create ecosystem and commercial bias.

### Stage 1 — seed normalization

Fingerprint every seed, preserve raw artifacts, normalize locators, and create stable external identifiers. Build a seed-to-session-to-speaker-to-organization graph with event edition as temporal context.

### Stage 2 — first-pass description and categorization

Run the existing v2 pipeline. Produce transcript-grounded summaries, engineering categories, lifecycle stages, organization profiles, named technologies, verified sources, curriculum signals, and explicit uncertainty. Do not broaden the current packet until campaign contracts exist.

### Stage 3 — frontier extraction

Turn every applied packet into candidates: entities; official docs, repositories, papers, cards, standards, benchmarks, datasets, changelogs, and engineering posts; unresolved claims; missing prerequisites; alternatives; people/teams to follow; and temporal monitors. Each candidate includes its discovery path, evidence, expected information gain, cost, and duplicate fingerprint.

### Stage 4 — multi-channel expansion

Use bounded channels with explicit roles:

1. Event catalogs for session, speaker, and talk completeness.
2. Documentation and repositories for implementation truth.
3. Paper indexes and citation expansion for scientific lineage.
4. Standards bodies for normative claims.
5. Engineering blogs, changelogs, and system/model cards for product state.
6. Strong secondary sources only for discovery, triangulation, and controversy.

Each channel produces an ordered list with native scores. Deduplicate identities, then combine rankings with Reciprocal Rank Fusion. Never compare raw provider scores directly.

### Stage 5 — entity resolution and assertion proposal

Resolve exact identifiers first, then canonical locators, then normalized names plus context. Never auto-merge only because embeddings are similar. Ambiguous merges become review tasks. Preserve disagreements as parallel assertions instead of averaging them away.

### Stage 6 — source qualification

Apply eligibility gates, source-class features, and the policy in `SOURCE_RANKING_AND_EVALUATION_SPEC.md`. Rank sources for a purpose; “best source” is not global. A repository may be best for API behavior while a peer-reviewed paper is best for an algorithmic claim.

### Stage 7 — domain portfolio prioritization

Compute coverage, gap, velocity, dependency centrality, project/curriculum leverage, source availability, uncertainty, and saturation. Select a portfolio rather than top N:

- 35% highest expected curriculum value;
- 20% foundational/prerequisite coverage;
- 15% fast-changing frontier monitoring;
- 15% undercovered domains and diversity;
- 10% verification/conflict resolution;
- 5% exploratory wildcards.

### Stage 8 — research job selection

Select subject to budgets, diversity constraints, duplicate suppression, and authority coverage. Emit bounded `research_job` contracts naming exact questions, entities, claims to verify, preferred sources, expected artifacts, acceptance tests, and stop conditions.

### Stage 9 — deep research and deterministic ingestion

The next system gathers deeper evidence and emits a versioned bundle and ingestion intent. Deterministic code validates identifiers, hashes, ontology versions, source policy, anchors, operation allowlists, and idempotency before writes.

### Stage 10 — curriculum discovery

Aggregate accepted claims and signals into a capability graph: concepts and techniques, prerequisite chains, production tasks/failures, implementation alternatives, outcomes/misconceptions, lab/challenge/project candidates, assessment requirements, and refresh policies. A popular talk is a discovery signal, not automatically a lesson.

### Stage 11 — monitoring and refresh

Create monitors from accepted high-priority entities and locators. A changed digest opens a new observation and affected-assertion review; it never overwrites history.

“Following” is an observation layer, not an authority shortcut:

| Target | Watch | Prefer as evidence | Treat only as discovery/attention signal |
| --- | --- | --- | --- |
| Engineer/researcher | talks, papers, repositories, maintainer roles, official profile changes | authored paper/repository/talk and verified organization source | followers, reposts, unsourced biography |
| Paper | versions, citations, related work, code/data, corrections | paper body, supplements, official artifacts | abstract-only similarity or citation count alone |
| Library/framework | releases, tags, docs, deprecations, security notices, maintainers | versioned docs, source/tests, release notes, advisories | stars, trend posts, generated examples |
| Product/model | docs, cards, changelog, pricing/status, benchmarks, API changes | current official materials plus independent reproducible evidence | launch attention, vendor benchmark alone |
| Standard/protocol | drafts, releases, issues, implementations | normative specification and conformance evidence | commentary that omits version/status |

Popularity, citation count, and social velocity may increase discovery priority, but cannot increase the authority score for a claim.

### Stage 12 — learning loop

Every run emits an episode and receives deterministic/ranking evals. Aggregate evidence before requesting code, prompt, skill, or policy changes. Candidates run against frozen, hidden, temporal, and adversarial sets and can reach shadow/canary only after independent review.

## 6. Fixed facets versus emergent vocabulary

Keep stable and reviewed: the 17 categories, provenance/evidence grades, identity envelope, assertion/supersession mechanics, authority classes, lifecycle stages, and review/publication states.

Let versioned rows evolve: subdomains, topic clusters, library/model families, narrow predicates, curriculum roles, project patterns, source-role refinements, and prerequisite/alternative relationships.

Promote an ontology candidate only when it has at least three independent examples, improves retrieval/editorial clarity on an eval set, has a clear parent/definition, does not duplicate a term, and receives review. Emergency candidates remain provisional.

## 7. Retrieval contract for the learner application

Design ingestion around learner decisions:

- What solves this project requirement?
- What are the credible alternatives and trade-offs?
- What must I learn first?
- Which version is current as of a date?
- What production evidence exists?
- What breaks, costs more, or creates lock-in?
- Which challenge proves I can use it?

Expose planner modes for lexical lookup, semantic candidates, graph expansion, temporal validity, curriculum state, and evidence reranking. Return evidence objects with canonical IDs, artifact locator, anchor, observed/effective dates, authority, confidence, retrieval route, and score. Generated prose cites only returned evidence.

## 8. Capability bundle

### Skills: instructions and judgment

- `campaign-planning`
- `source-policy`
- `paper-discovery`
- `documentation-repository-research`
- `entity-resolution`
- `ontology-proposal`
- `ranking-policy`
- `curriculum-signal-mining`
- `evaluation-and-optimization`
- `cursor-cloud-agent`

### Trusted tools: execution authority

- web search; exact page scrape/crawl; research-paper search/read; repository/docs search; event catalogs/transcripts;
- allowlisted artifact registry and deterministic ranking/evaluation tools;
- read-only graph/retrieval queries for agents;
- server-side Cursor lifecycle adapter;
- no arbitrary SQL, Cypher, deployment, or unrestricted credentials exposed to models.

Prefer authored Eve tools for typed, policy-enforced behavior. MCP is appropriate for reusable external boundaries. Skills never contain credentials and never substitute for authorization.

### Cursor surface selection

| Surface | Role in this architecture |
| --- | --- |
| TypeScript SDK | primary server-side adapter for typed Cloud Agent lifecycle and run streaming |
| Cloud Agents HTTP API | compatibility/fallback surface and explicit lifecycle contract |
| Cursor CLI headless mode | local or CI diagnostics and bounded one-off jobs; not the durable scheduler or authority layer |
| Cursor Automations | scheduled/event-originated repository work after the same proposal, budget, and permission gates |

The Eve control plane owns why and whether a change is requested. Cursor owns candidate execution in its workspace. Independent evaluators and human approval own promotion.

## 9. Primary references

- [Eve execution model and durability](https://eve.dev/docs/concepts/execution-model-and-durability)
- [Eve schedules](https://eve.dev/docs/schedules)
- [Eve Workflow tool](https://eve.dev/docs/subagents/workflow-tool)
- [Vercel Workflows](https://vercel.com/docs/workflows)
- [Cursor Cloud Agent API](https://cursor.com/docs/cloud-agent/api/endpoints)
- [Cursor Automations](https://cursor.com/docs/cloud-agent/automations)
- [Neo4j vector indexes](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/vector-indexes/)
- [Neo4j full-text indexes](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/)
- [Reciprocal Rank Fusion](https://dl.acm.org/doi/10.1145/1571941.1572114)
- [AI Engineer machine-readable catalog](https://www.ai.engineer/llms.md)
