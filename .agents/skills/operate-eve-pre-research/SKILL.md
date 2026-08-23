---
name: operate-eve-pre-research
description: "Operate the research-starter pre-research Eve v2 deployment: audit the qualified queue, confirm or resume the production scheduler, inspect durable pipeline runs and Eve session streams, verify completed packets, and connect safely to the deployment. Use only for this repository's deployed pre-research workflow."
---

# Operate Eve pre-research

Work from `research_starter_pre_research_agent/`. On a fresh handoff, read `HANDOFF-2026-08-21-PRE-RESEARCH.md` before acting. Postgres plus Supabase Storage are authoritative; Vercel logs explain execution, and local `outputs/` do not establish completion.

Read [references/operations.md](references/operations.md) for the exact commands and safety boundaries.

## Default operating decision

Keep the deployed `pre-research-next` Cron worker running when it is healthy. It dispatches at most one pipeline per five-minute tick under a project-wide Postgres advisory lock, resumes cooldown-eligible v2 runs before claiming another qualified video, and preserves every completed artifact boundary.

Do not start a local/manual pipeline merely because a run is waiting or one tick overlaps. Treat a run as potentially stuck only when both its artifact count and `updated_at` fail to advance across several cooldown-eligible ticks.

## Required boundaries

- Never run `pipeline:all` while the production schedule is enabled.
- Before any manually controlled pipeline, pause production dispatch, deploy the disabled configuration, observe a `disabled` Cron outcome, and allow any prior lock owner to settle.
- Do not send ad hoc messages to controller-owned stage sessions. Inspect them read-only and let the controller issue its bounded checkpoint nudge.
- Do not cancel, clear, compact, or reset a stage session unless normal scheduled recovery has demonstrably failed and the user has authorized that mutation.
- Do not approve a `review_required` run without resolving the organization identity or hierarchy conflict.
- Always pass `--scope overtons-projects` to Vercel commands. The directory is already linked; do not create another project.
- Use normal source deployment, not `--prebuilt` and not `npx eve deploy`, on this Windows workspace.

## Completion signal

The qualified drain is complete only when the canonical queue audit reports both `count: 0` and `recoverable_count: 0`. Inspect the review queue separately; a genuine `review_required` packet is intentionally outside automatic draining. Canonically verify each newly applied run before treating it as proof-quality output.
