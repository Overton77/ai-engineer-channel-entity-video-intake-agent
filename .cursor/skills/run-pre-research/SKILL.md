---
name: run-pre-research
description: Run the research_starter_pre_research_agent v2 nine-stage pipeline against stored YouTube transcripts. Use when starting the built Eve server, claiming the next eligible video, or running one qualified video_id through the controller.
---

# Run pre-research v2 pipeline

Work from `research_starter_pre_research_agent/`. Read [HANDOFF.md](../../../HANDOFF.md) if this is a fresh session.

Controller: `controller/pre-research-pipeline.ts`. CLI: `scripts/run-pre-research-pipeline.mjs`. Packet schema `2.0.0`, prompt bundle `pre-research-2.0.0`. Storage prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`.

The controller runs nine sequential, stage-isolated Eve root sessions across research (`00`–`50`) and synthesis (`60`–`90`). The controller owns every stage cutover. Eve sessions must not mark the pipeline finished. The default path disables subagents plus sandbox/file tools; phase save tools materialize Supabase files directly (and host files only off Vercel), so the pipeline does not provision Docker/Vercel sandbox containers. A transient provider failure parks the current stage session. Controller-owned phase/stage identity and delivery count are persisted in the session row's `result_summary`, so a later Cron tick can validate reuse without replaying unbounded Eve history; reuse is capped at 18 deliveries. Current boundary inspection reads only a bounded, abortable event tail. Stage changes always use a fresh session. The AI SDK already makes three attempts per model delivery, so the controller makes at most one additional parked-turn delivery per Cron dispatch. If Eve rejects it, exhausts that retry, or remains silent beyond the 120-second controller wait budget, the controller returns `waiting` without cancelling Eve. The production schedule also passes one absolute four-minute controller deadline across every stage in that invocation, leaving a one-minute cleanup margin below Vercel's 300-second limit. The scheduler then applies a ten-minute retry cooldown to that run, allowing another qualified video to use the intervening serial tick rather than letting one provider-stuck run starve the backlog. The project-wide advisory lock still permits only one executing video at a time. Override the stage wait with `PRE_RESEARCH_CONTROLLER_STAGE_WAIT_MS` (15,000–240,000 ms), the scheduled invocation budget with `PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS` (60,000–270,000 ms), and the whole-minute cooldown with `PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES` (5–60).

Network capability is stage-scoped. Eve's framework `web_fetch` is disabled globally and dynamically restored only for `web_context`, `organization_research`, and `source_verification`. The provider-managed `web_search` definition must remain static under Eve 0.38.3; offline stages forbid it by instruction and the database ledger enforces budgets of 0/3/3/2/0 across transcript-taxonomy, web context, organization research, source verification, and curriculum. Do not wrap `webSearch()` with `defineTool` or return it from `defineDynamic`.

The controller never injects a raw transcript into Eve history. Before the research turn, it splits every transcript into bounded character sections and uses GLM 5.2 as an iterative reducer: each cumulative transcript summary is passed into the next section. After every successful section it saves a resumable checkpoint under `_controller-cache/v2/<video_id>/<run_id>.sections.json`; after reduction it caches the validated compact result under `_controller-cache/v2/<video_id>/<run_id>.json`. Both are validated against the video, run, transcript hash, and chunking configuration before reuse. Only the compact result is passed into Eve. Override the 12,000-character default with `PRE_RESEARCH_TRANSCRIPT_CHUNK_CHARACTERS` (minimum 2,000).

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

Always use `npm run list:eligible` for the current oldest candidate; the backlog changes as runs finish and transcripts arrive. Finished current-transcript runs and occupied review runs are excluded.

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

3. Run the pipeline (the controller starts each bounded Eve stage session):

```bash
# oldest eligible
npm run pipeline:next

# specific qualified video
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id -rsTkYgnNzM
```

Other flags: `--run-id`, `--research-only`, `--synthesis-only` (requires `--run-id`), `--approved`, `--eve-url`.

After one video passes end-to-end verification, drain qualified videos serially. In production, Eve schedule `pre-research-next` runs every 5 minutes and uses a Postgres advisory lock to guarantee one active dispatcher. It selects the least-recently-dispatched retry-ready run first; if every unfinished run is cooling down, it claims another qualified video. Parked runs remain durable and rotate back in after the cooldown:

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

- Separate bounded Eve stage sessions recorded in the session ledger
- Artifacts `00`–`99` under `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`
- `pre_research_pipeline_finished` is true only after apply plus a hash-verified packet

For a manual/local batch, stop on the first failed phase and do not start a second video until the first pipeline returns. Production may retain more than one parked run for fairness, but it never executes them concurrently.

The v1 runner `scripts/run-pre-research-session.mjs` still exists. It is not the primary path.

## Do not

- Use `research_ingestion_systems_agent`
- Let an Eve session mark the pipeline finished
- Run an additional local batch while the production schedule is enabled
- Run concurrent video pipelines; `pipeline:all` and the scheduled dispatcher are deliberately serial
- Backfill v1
- Treat `--video-id` as a qualification bypass
- Commit `.env`
