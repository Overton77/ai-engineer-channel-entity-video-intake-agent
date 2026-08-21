---
name: run-pre-research
description: Run the research_starter_pre_research_agent v2 two-session pipeline against stored YouTube transcripts. Use when starting the built Eve server, claiming the next eligible video, or running one qualified video_id through the controller.
---

# Run pre-research v2 pipeline

Work from `research_starter_pre_research_agent/`. Read [HANDOFF.md](../../../HANDOFF.md) if this is a fresh session.

Controller: `controller/pre-research-pipeline.ts`. CLI: `scripts/run-pre-research-pipeline.mjs`. Packet schema `2.0.0`, prompt bundle `pre-research-2.0.0`. Storage prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`.

The controller starts two sequential Eve root sessions: research (`00`–`50`) then synthesis (`60`–`90`). The controller owns the cutover. Eve sessions must not mark the pipeline finished. The default path disables subagents plus sandbox/file tools; phase save tools materialize host and Supabase files directly, so the pipeline does not provision Docker/Vercel sandbox containers.

The controller never injects a raw transcript into Eve history. Before the research turn, it splits every transcript into bounded character sections and uses GLM 5.2 as an iterative reducer: each cumulative transcript summary is passed into the next section. It caches the compact result per run and passes only that result into Eve. Override the 12,000-character default with `PRE_RESEARCH_TRANSCRIPT_CHUNK_CHARACTERS` (minimum 2,000).

## Preconditions

1. `.env` exists (copy `.env.example`). Need `AI_GATEWAY_API_KEY`, `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
2. Do **not** set `EXA_API_KEY`. `web_search` uses Exa through AI Gateway.
3. Model stays `zai/glm-5.2`. Eve is `0.38.3`.

## Choose a mode

| User said | Mode | Command |
| --- | --- | --- |
| one id, "this video", or a YouTube id | specific | `--video-id <id>` |
| "first", "oldest", "smoke test", or no id | next | `--next` or `npm run pipeline:next` |
| "all", "every", "drain backlog", or "backfill" | all (serial) | `npm run pipeline:all` |
| resume an existing run | resume | `--run-id <uuid>` plus optional `--research-only` or `--synthesis-only` |

Claim is 6-arg. `--video-id` cannot bypass qualification.

Always use `npm run list:eligible` for the current oldest candidate; the backlog changes as runs finish and transcripts arrive. `TRjq7t2Ms5I` remains excluded while its live v1 run exists.

## Steps

1. List candidates:

```bash
npm run list:eligible
```

2. Build and start the production-style Eve server if it is not already up:

```bash
npm run build
$env:PRE_RESEARCH_LOCAL_EVE_START='true'; $env:PORT='2000'; npm run start -- --host 127.0.0.1
```

Wait until `GET http://127.0.0.1:2000/eve/v1/health` succeeds.

3. Run the pipeline (controller starts both Eve sessions):

```bash
# oldest eligible
npm run pipeline:next

# specific qualified video
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id -rsTkYgnNzM
```

Other flags: `--run-id`, `--research-only`, `--synthesis-only` (requires `--run-id`), `--approved`, `--eve-url`.

After one video passes end-to-end verification, drain qualified videos serially:

```bash
# bounded batch smoke
npm run pipeline:all -- --max-videos 2

# drain until NO_ELIGIBLE_VIDEO; stops on the first incomplete/failed video
npm run pipeline:all
```

Related npm scripts: `pipeline:next`, `pipeline:all`, `maintenance:prune-eve-runtime`, `apply:intent`, `list:eligible`, `test`, `typecheck`.

Use `eve start` for pipelines. On Windows, long `eve dev` turns can be redelivered by the local workflow transport and rapidly grow `.eve/.workflow-data`. After stopping Eve, `npm run maintenance:prune-eve-runtime` safely removes only that generated workflow state.

4. Confirm the run with `.agents/skills/query-pre-research` (Cursor verification, not Eve):

```bash
npm run query:pre-research -- --video-id=<id>
```

- Two distinct Eve session IDs
- Artifacts `00`–`99` under `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`
- `pre_research_pipeline_finished` is true only after apply plus a hash-verified packet

Stop on the first failed phase. Do not start a second video until the first pipeline returns.

The v1 runner `scripts/run-pre-research-session.mjs` still exists. It is not the primary path.

## Do not

- Use `research_ingestion_systems_agent`
- Let an Eve session mark the pipeline finished
- Enable the production schedule
- Run concurrent video pipelines; `pipeline:all` is deliberately serial
- Backfill v1
- Treat `--video-id` as a qualification bypass
- Commit `.env`
