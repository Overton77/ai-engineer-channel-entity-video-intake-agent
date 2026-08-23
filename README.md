# research_starter_pre_research_agent

New Eve agent. It is not the existing `research_ingestion_systems_agent`.

This agent reads `public.research_starter_videos` plus stored YouTube transcripts, then categorizes, contextualizes, and writes a transcript-grounded initial summary as a validated ingestion intent. A deterministic executor, with no model access, applies that intent to the `research_*` tables.

It is one slice of a larger composition: research → course, challenge, and knowledge-base creation. This repo is the pre-research intake agent only.

**Uses:** Vercel Eve, AI Gateway, and Supabase Postgres/Storage. The default pipeline disables subagents and sandbox/file tools; authored save tools materialize artifacts directly.

## Status

The primary path is the v2 two-session pipeline. Eve `0.38.3`, model `zai/glm-5.2`, packet schema `2.0.0`, prompt bundle `pre-research-2.0.0`.

The controller in `controller/pre-research-pipeline.ts` claims a qualified video, runs registered research stages (`00`–`50`), then registered synthesis stages (`60`, `70`, `80`, `90`). It clears model history between durable checkpoints and has no subagent fan-out. Every transcript is split into bounded sections and reduced iteratively, passing the prior cumulative summary into the next GLM 5.2 call without putting raw transcript text into Eve history. The controller owns the cutover. Eve sessions must not mark the pipeline finished.

Durable artifacts go to `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`. The executor applies the intent after synthesis. `pre_research_pipeline_finished` is true only after apply plus a hash-verified packet.

The retired prompt-only cron was removed; backlog processing is owned by the serial controller. Do not run concurrency 3 or backfill v1.

v2 contract and slices: [implementation/](./implementation/) and [implementation/goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md](./implementation/goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md). The original v1 spec remains in [IMPLEMENTATION.md](./IMPLEMENTATION.md).

Evaluation system: [evals/README.md](./evals/README.md) and [implementation/goal/EVALUATION_SYSTEM.md](./implementation/goal/EVALUATION_SYSTEM.md). It includes Eve-native packet and trace evals, an eight-case production golden set, semantic judge cases, deterministic offline reports, and a paired-bootstrap promotion gate for implementation optimizers.

## Run

Handoff for another agent: [HANDOFF.md](./HANDOFF.md). Runner skill: `.cursor/skills/run-pre-research/SKILL.md`.

```bash
cp .env.example .env
# fill AI_GATEWAY_API_KEY, POSTGRES_URL or POSTGRES_URL_NON_POOLING,
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run build
$env:PRE_RESEARCH_LOCAL_EVE_START='true'; $env:PORT='2000'; npm run start -- --host 127.0.0.1
npm run list:eligible
npm run pipeline:next
# after one successful smoke run, process all remaining qualified videos serially:
npm run pipeline:all
# or cap a batch:
npm run pipeline:all -- --max-videos 2
# or a specific qualified video:
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id <id>
```

Use the built `eve start` server for pipeline and batch work. On Windows, long `eve dev` turns can be redelivered by the local workflow transport and rapidly grow `.eve/.workflow-data`. After stopping Eve, `npm run maintenance:prune-eve-runtime` removes only generated local Eve workflow state; it does not touch outputs, Supabase data, or Docker images.

Do not set `EXA_API_KEY`. `web_search` uses Exa through AI Gateway.

`--video-id` cannot bypass qualification. Claim is 6-arg. Use `npm run list:eligible` for the current oldest candidate. Set `PRE_RESEARCH_TRANSCRIPT_CHUNK_CHARACTERS` only to override the default 12,000-character iterative-summary section size (minimum 2,000). `PRE_RESEARCH_MIN_FREE_GB` controls the local disk guard (default 1.5 GiB). Production Cron retries parked runs with a default ten-minute fairness cooldown (`PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES`, 5–60), so one provider-stuck video cannot monopolize every serial tick. Its controller also has an absolute four-minute invocation budget (`PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS`, 60,000–270,000 ms), leaving cleanup headroom below Vercel's 300-second limit.

The v1 runner `scripts/run-pre-research-session.mjs` still exists. It is not the primary path.

## Source catalog

Qualification is evaluated live against transcript status/text, the Supabase object, `0 < duration_seconds < 5400`, and the current transcript SHA. `--video-id` cannot bypass those predicates.
