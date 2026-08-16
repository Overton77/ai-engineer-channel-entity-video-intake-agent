# Pre-research v2 implementation index

Shared files for every agent session working this goal. Read in this order.

| File | Purpose |
| --- | --- |
| [goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md](./goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md) | Full v2 contract. Do not weaken it. |
| [SCOPE.md](./SCOPE.md) | Approved 2026-08-16. Code mission is complete; live smoke is next. |
| [PROGRESS.md](./PROGRESS.md) | What shipped, remote apply notes, leftover risk. |
| [HANDOFF.md](./HANDOFF.md) | How the next session runs one live v2 video without re-deriving the plan. |

Codebase: `research_starter_pre_research_agent/`  
Schema migrations: `../supabase/migrations/` (shared Supabase project, not inside the Eve app)  
Eve docs: `research_starter_pre_research_agent/node_modules/eve/docs/` (installed `eve@0.38.3`)  
Eve skill pointer: `research_ingestion_systems_agent/.agents/skills/eve/SKILL.md`  
Vercel Workflow: Eve already deploys onto Vercel Workflow. The durable two-session controller is a Workflow, not a second Eve project.
