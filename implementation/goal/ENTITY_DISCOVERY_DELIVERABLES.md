# Entity discovery mission deliverables

Start with `ENTITY_DISCOVERY_SYSTEM_SPEC.md`; it is the narrative and consolidated decision document.

| Artifact | Role |
| --- | --- |
| `ENTITY_DISCOVERY_SYSTEM_SPEC.md` | end-to-end narrative, architecture, taxonomy, metric strategy, acquisition proof, and implementation sequence |
| `TAXONOMY_EXPANSION_RESEARCH.md` | full 2026 taxonomy facets, relations, assignment contract, and examples |
| `METRIC_SOURCE_CATALOG.md` | official/open/licensed sources, identifiers, access, history, rate/terms cautions, connector rollout |
| `ENTITY_SCORING_MODEL.md` | normalization, time, uncertainty, anti-gaming, propagation, purpose scorecards, diversity, evaluation |
| `SOURCE_RANKING_AND_EVALUATION_SPEC.md` | companion source/evidence ranking policy |
| `contracts/entity-ranking.ts` | executable Zod contracts for observations, features, and ranking snapshots |
| `tests/entity-ranking.test.mts` | contract examples and invariants |
| `scripts/probe-entity-metrics.mjs` | live multi-provider capability probe using local environment credentials |
| `METRIC_PROBE_RESULTS.json` | public/authenticated live probe snapshot |
| `METRIC_PROBE_PAID_AND_FALLBACK_RESULTS.json` | PyPI/Crossref/xAI capability results and failures |
| `.firecrawl/search-*.json` | raw Firecrawl research artifacts retained locally for audit |

The existing `KNOWLEDGE_DISCOVERY_ARCHITECTURE.md` remains the system-wide baseline. These artifacts extend its discovery frontier into entity taxonomy, metric acquisition, scoring, and the deep-research handoff.
