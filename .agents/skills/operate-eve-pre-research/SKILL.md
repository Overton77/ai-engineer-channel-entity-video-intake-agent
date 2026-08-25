---
name: operate-eve-pre-research
description: "Operate the research-starter pre-research stateless v3 deployment: audit the qualified queue, confirm or resume the production scheduler, inspect the Supabase stage ledger and immutable objects, verify completed packets, and inspect legacy Eve sessions read-only when needed. Use only for this repository's deployed pre-research workflow."
---

# Operate Eve pre-research

Work from `research_starter_pre_research_agent/`. On a fresh handoff, read `HANDOFF-2026-08-24-STATELESS-PRE-RESEARCH.md` before acting. Postgres plus Supabase Storage are authoritative; Vercel logs explain execution, and local `outputs/` do not establish completion.

Read [references/operations.md](references/operations.md) for the exact commands and safety boundaries.

## Default operating decision

Use exactly one worker. For normal steady-state operation, keep the deployed `pre-research-next` Cron worker running when it is healthy. It wakes every minute, dispatches at most one stateless stage by default under a project-wide Postgres advisory lock, resumes retry-ready current-prompt v2 packet runs before claiming another qualified video, and preserves every completed artifact boundary.

When a time-limited model-credit window makes Cron-only throughput insufficient, keep production dispatch disabled and run the deadline-free local serial drain. The local process finishes all nine stages for one video before claiming the next; only transcript/taxonomy, web context, and organization research use GLM. The remaining stages are deterministic controller hydration over artifacts loaded from Supabase Storage.

Do not start a local/manual pipeline merely because a run is waiting or one tick overlaps. Treat a run as potentially stuck only when the stage ledger, artifact count, and `updated_at` all fail to advance across several retry-eligible ticks.

## Required boundaries

- Never run `pipeline:all` while the production schedule is enabled.
- Never infer that a Vercel function, Eve runtime space, or sandbox remains alive between ticks. Continuity comes from Postgres leases/stage rows and immutable Supabase Storage objects.
- Before any manually controlled pipeline, pause production dispatch, deploy the disabled configuration, observe a `disabled` Cron outcome, and allow any prior lock owner to settle.
- New batch runs do not have controller-owned Eve stage sessions. Legacy session IDs are historical metadata only; inspect them read-only and never attach them to the v3 controller.
- Do not cancel, clear, compact, or reset a legacy stage session unless separately authorized for legacy cleanup.
- Do not approve a `review_required` run without resolving the organization identity or hierarchy conflict. A genuine review is a terminal batch outcome and the drain moves to the next video.
- Always pass `--scope overtons-projects` to Vercel commands. The directory is already linked; do not create another project.
- Use normal source deployment, not `--prebuilt` and not `npx eve deploy`, on this Windows workspace.

## Completion signal

The qualified drain is complete only when the canonical queue audit reports both `count: 0` and `recoverable_count: 0`. Inspect the review queue separately; a genuine `review_required` packet is intentionally outside automatic draining. Canonically verify each newly applied run before treating it as proof-quality output.
