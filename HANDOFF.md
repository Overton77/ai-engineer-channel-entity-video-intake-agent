# Handoff: pre-research v2 pipeline

Project: `research_starter_pre_research_agent/`

Eve: `0.38.3`

Model: `zai/glm-5.2`

Packet schema: `2.0.0`
Prompt bundle: `pre-research-2.0.0`

The controller claims one qualified video, runs a research root session (`00`-`50`), runs a separate synthesis root session (`60`-`90`), then applies the intent deterministically. Eve sessions never mark the pipeline finished.

## Current architecture (2026-08-20)

- `load_video_context` keeps raw transcript text out of Eve conversation and subagent history. It always splits transcripts into bounded sections (12,000 characters by default), calls GLM 5.2 sequentially, and passes each cumulative summary into the next section.
- The pipeline has no subagent fan-out. `agent` and Workflow tools are disabled, and the retired specialist declarations were removed so Eve does not prewarm their sandbox templates.
- Sandbox/file tools are disabled. Authored database, model, search, and storage tools run in the app runtime and phase save tools materialize host/Supabase artifacts directly, so no Docker/Vercel sandbox VM is needed.
- Session input/output budgets are 2,000,000 / 100,000 tokens with compaction at 70% of the model context.
- `npm run pipeline:all` drains the eligible backlog serially and stops on the first incomplete/failed video. `--max-videos N` bounds a smoke batch.

The earlier OpenPipe run `334e0124-0ea3-4800-8c20-7df4728f7e53` for `gEDl9C8s_-4` is now applied and finished. It is no longer a resume target.

## Preconditions

`.env` needs:

- `AI_GATEWAY_API_KEY`
- `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not set `EXA_API_KEY`. Keep the model at `zai/glm-5.2`.

## Run and verify

```bash
npm run typecheck
npm test
npm run list:eligible
npm run build
$env:PRE_RESEARCH_LOCAL_EVE_START='true'; $env:PORT='2000'; npm run start -- --host 127.0.0.1

# one smoke video
npm run pipeline:next

# then a bounded serial batch
npm run pipeline:all -- --max-videos 2

# finally drain all currently qualified videos
npm run pipeline:all

# verify one result from Postgres + Supabase
npm run query:pre-research -- --video-id=<id>
```

`--video-id` cannot bypass qualification. Eligibility requires a stored, non-empty transcript, the expected Supabase object, `0 < duration_seconds < 5400`, and no live/applied/finished run for the current transcript SHA.

## Success criteria

- Two distinct root Eve session IDs
- Twelve registered and hash-matching objects under `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`
- `run_status=applied`, `intent_status=applied`, `pre_research_pipeline_finished=true`
- Transcript bucket SHA equals the run transcript SHA

## Local disk

Local Eve workflow streams live under `.eve/.workflow-data/streams`. Old streams are disposable only while Eve is stopped; Postgres and Supabase are the durable checkpoints. The reduced architecture avoids raw transcript events and specialist streams, so new growth should be much smaller than legacy runs.

Use `eve start`, not `eve dev`, for long GLM turns and serial batches. The Windows dev transport was observed redelivering in-flight turns and rapidly growing `.eve/.workflow-data`. Once Eve is stopped, `npm run maintenance:prune-eve-runtime` clears that generated local queue/stream/lock state without touching outputs, Supabase, or Docker images.

## Do not

- Add a real controller-bound schedule only if serial CLI/Vercel dispatch is later replaced
- Run concurrent video pipelines
- Use the older `research_ingestion_systems_agent`
- Backfill v1
- Commit `.env`
