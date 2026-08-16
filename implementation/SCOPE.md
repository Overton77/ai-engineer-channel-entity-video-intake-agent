# Mission scope — pre-research v2 vertical slice

Status: **approved 2026-08-16**  
Date: 2026-08-16  
Implementer target: one coding session after approval  
Plan: [goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md](./goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md)

## What this mission is

Ship a **working v2 vertical slice** for one video: qualify → claim → research session (`00`–`50`) → trusted `research_complete` → synthesis session (`60`–`90`) → deterministic apply → `99` receipt → transcript-hash-aware `finished`.

That is the smallest scope that still honors the plan’s non-negotiables:

- Keep `zai/glm-5.2` and Eve `web_search({ provider: "exa" })`.
- Models propose; trusted TypeScript and SQL persist.
- Two deterministically started Eve root sessions in one project, one Vercel deployment.
- Vercel Workflow owns the phase transition. The research model does not start synthesis.
- Intent file remains the model-to-database contract.
- Finish state lives on `research_pre_research_video_state`, keyed to the current transcript SHA-256.

## What this mission will complete

### Slice 1 — schema and qualification (first)

Additive migration after `20260815021906_claim_pre_research_video_digest_search_path.sql`:

- Run metadata, `research_complete` / `synthesizing` statuses, session ledger
- `research_pre_research_video_state` with correctly spelled `pre_research_pipeline_finished`
- Contextualized initial-summary, technology-family, organization enums/tables/sources
- Artifact registry
- Tightened claim RPC, qualification refresh, phase-transition RPCs
- `research_private.list_finished_pre_research_videos`
- Schema skill/reference update

No backfill migration in this mission.

### Slice 2 — contracts and shared helpers

- Packet schema `2.0.0`, prompt bundle `pre-research-2.0.0`
- New artifact schemas `35`, `60`, `70`, `80`
- Four new allowlisted intent operations
- Canonical JSON + SHA-256 helpers
- URL normalization and organization-source invariants
- Execution-receipt v2 fields

Keep v1 schemas readable so the executor can dispatch by version later. Do not rewrite existing v1 output files.

### Slice 3 — durable packet tools

- Real Supabase Storage upload using service-role credentials in app-side code only
- `save_research_phase_packet` (`00`–`50`)
- `load_research_phase_packet` (synthesis-only, hash-verified)
- `save_pre_research_packet` (`60`–`90` + intent ledger)
- Register artifacts only after a successful upload

### Slice 4 — Eve phase split

- Short stable `agent/instructions.md`
- `defineDynamic` phase instructions/tools/skills/subagents at `turn.started`
- New `organization_researcher` subagent
- Research session cannot write `60`–`90`
- Synthesis session cannot call research subagents
- `maxSubagents` ≥ 6
- Claim tool writes `research_as_of` and packet version from trusted time

### Slice 5 — Vercel Workflow controller + executor

- Durable Workflow: claim → create research session → wait → verify `00`–`50` → `research_complete` → create synthesis session → wait → verify `60`–`90` → apply intent → upload `99` → mark finished
- `eve/client` starts the two sessions; Workflow steps persist session IDs and phase receipts
- Local CLI that starts the same Workflow / equivalent step sequence for `eve dev`
- Real `executor/apply-intent.ts` + operation handlers + apply CLI
- Review-required / `other_unknown` / missing authoritative sources do not auto-apply
- Receipt failure leaves `finalizing`, not `finished`

### Slice 6 — runner, docs, unit tests

- Qualification-aware `eligible-videos` / `list-eligible-videos` / run scripts
- Update agent `README.md`, agent `HANDOFF.md`, `.cursor/skills/run-pre-research/SKILL.md`
- Unit tests for contracts, canonical hashing, URL normalization, qualification mapping, operation handlers, finalization
- `npm run typecheck` and `eve build` pass

## Out of this mission

These remain in the plan and are explicit follow-on work:

- Data backfill of old v1 rows
- Production dispatcher concurrency (3 research / bounded synthesis)
- 8-video live smoke matrix, 10-video batch, 40–50 golden set, Eve evals
- `post_research_synthesizer` subagent
- Downstream paid deep-research / curriculum / official-ingestion consumers
- Enabling the production schedule after smoke

## Success for this mission

A later session can take one eligible video (`-rsTkYgnNzM`; do not reuse `TRjq7t2Ms5I` while its v1 `intent_ready` run is live) and, with Eve running, produce:

```text
research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/
  00 … 50, 60, 70, 80, 90, 99
```

plus matching Postgres rows, two distinct Eve session IDs, and

```text
pre_research_pipeline_finished = true
  iff current transcript hash has applied intent + tables + hash-verified 00–99
```

Live GLM/Exa smoke is **validation after this mission**, not a gate that blocks shipping the code.

## Non-negotiable constraints

- Do not add a second model, Exa API key, paid research tool, or second Eve project.
- Do not write to aiengineerapp learner/entity tables.
- Do not edit already-applied migrations.
- Do not let `--video-id` bypass qualification.
- Do not mark finished from an Eve session.
