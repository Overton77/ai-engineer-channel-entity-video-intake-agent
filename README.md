# research_starter_pre_research_agent

New Eve agent. It is not the existing `research_ingestion_systems_agent`.

This agent reads `public.research_starter_videos` plus stored YouTube transcripts, then categorizes, contextualizes, and writes a transcript-grounded initial summary as a validated ingestion intent. A deterministic executor, with no model access, applies that intent to the `research_*` tables.

It is one slice of a larger composition: research → course, challenge, and knowledge-base creation. This repo is the pre-research intake agent only.

**Uses:** Vercel Eve agent, workflows, sandboxes, and Postgres.

## Status

The primary path is the v2 two-session pipeline. Eve `0.38.3`, model `zai/glm-5.2`, packet schema `2.0.0`, prompt bundle `pre-research-2.0.0`.

The controller in `controller/pre-research-pipeline.ts` claims a qualified video, starts a research Eve session (`00`–`50`), then starts a separate synthesis Eve session (`60`–`90`). The controller owns the cutover. Eve sessions must not mark the pipeline finished.

Durable artifacts go to `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`. The executor applies the intent after synthesis. `pre_research_pipeline_finished` is true only after apply plus a hash-verified packet.

Do not enable the production schedule. Do not run concurrency 3. Do not backfill v1.

v2 contract and slices: [implementation/](./implementation/) and [implementation/goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md](./implementation/goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md). The original v1 spec remains in [IMPLEMENTATION.md](./IMPLEMENTATION.md).

## Run

Handoff for another agent: [HANDOFF.md](./HANDOFF.md). Runner skill: `.cursor/skills/run-pre-research/SKILL.md`.

```bash
cp .env.example .env
# fill AI_GATEWAY_API_KEY, POSTGRES_URL or POSTGRES_URL_NON_POOLING,
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm exec -- eve dev --no-ui --port 2000
npm run list:eligible
npm run pipeline:next
# or a specific qualified video:
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id <id>
```

Do not set `EXA_API_KEY`. `web_search` uses Exa through AI Gateway.

`--video-id` cannot bypass qualification. Claim is 6-arg. `TRjq7t2Ms5I` has a live v1 run (`intent_ready`, `0af07c2e-bb23-46e1-9661-0a32c67a3715`) and cannot be reclaimed until that run is superseded or applied. Next oldest eligible smoke video: `-rsTkYgnNzM`.

The v1 runner `scripts/run-pre-research-session.mjs` still exists. It is not the primary path.

## Source catalog

Qualification refresh on 2026-08-16: 43 eligible / 1049 evaluated. Most catalog rows still lack a stored transcript. `--video-id` cannot bypass those predicates.
