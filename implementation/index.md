# Pre-research v2 implementation index

Shared files for every agent session working this goal. Read in this order.

| File | Purpose |
| --- | --- |
| [goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md](./goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md) | Full v2 contract. Do not weaken it. |
| [goal/KNOWLEDGE_DISCOVERY_ARCHITECTURE.md](./goal/KNOWLEDGE_DISCOVERY_ARCHITECTURE.md) | Governed schema evolution, discovery loop, system boundaries, and retrieval contract. |
| [goal/SOURCE_RANKING_AND_EVALUATION_SPEC.md](./goal/SOURCE_RANKING_AND_EVALUATION_SPEC.md) | Versioned source/domain/job ranking formulas, datasets, metrics, and gates. |
| [goal/KNOWLEDGE_DISCOVERY_IMPLEMENTATION_PLAN.md](./goal/KNOWLEDGE_DISCOVERY_IMPLEMENTATION_PLAN.md) | Migration order, file map, delivery slices, acceptance criteria, and Cursor/Eve rollout. |
| [SCOPE.md](./SCOPE.md) | Approved 2026-08-16. Code mission is complete; live smoke is next. |
| [PROGRESS.md](./PROGRESS.md) | What shipped, remote apply notes, leftover risk. |
| [HANDOFF.md](./HANDOFF.md) | How the next session runs one live v2 video without re-deriving the plan. |

## Architecture research

| File | Purpose |
| --- | --- |
| [EVE_MONOREPO_ARCHITECTURE_RESEARCH.md](./EVE_MONOREPO_ARCHITECTURE_RESEARCH.md) | Recommended multi-agent pnpm workspace, shared Eve extension, composed clients, optional orchestrator, and Vercel topology. |

Codebase: `research_starter_pre_research_agent/`  
Schema migrations: `../supabase/migrations/` (shared Supabase project, not inside the Eve app)  
Eve docs: `research_starter_pre_research_agent/node_modules/eve/docs/` (installed `eve@0.38.3`)  
Eve skill pointer: `research_ingestion_systems_agent/.agents/skills/eve/SKILL.md`  
Current automatic controller: stateless v3. It does not pass packet outputs through Vercel Workflow or create Eve stage sessions. Vercel Cron supplies short-lived wakeups; Postgres stage leases and immutable Supabase Storage objects supply durability and continuation.
