# Handoff: run the pre-research v2 pipeline

**Current session (2026-08-16):** stopped mid-synthesis on `gEDl9C8s_-4` because C: filled up. Read [HANDOFF-2026-08-16.md](./HANDOFF-2026-08-16.md) first. Eve sandbox containers are disposable; the checkpoint is in Postgres.

You are taking over a running Eve project. Do not scaffold a new agent. Your job is to start Eve and run one qualified video through the v2 two-session pipeline.

Project: `research_starter_pre_research_agent/`
Eve: `0.38.3`
Model: `zai/glm-5.2`
Controller: `controller/pre-research-pipeline.ts`
CLI: `scripts/run-pre-research-pipeline.mjs`
Skill: `.cursor/skills/run-pre-research/SKILL.md`
v2 contract: `implementation/goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md`
Shared DB: Supabase `wkythqbofmckbuoothhn`

Packet schema `2.0.0`. Prompt bundle `pre-research-2.0.0`. Storage prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`.

---

## What this pipeline does

The controller claims one qualified video, then starts two distinct Eve root sessions for the same run:

1. Research session writes artifacts `00`–`50`.
2. Synthesis session writes artifacts `60`–`90`.

The controller owns the cutover. Eve sessions must not mark the pipeline finished. After synthesis, the deterministic executor applies the intent. `pre_research_pipeline_finished` becomes true only after apply plus a hash-verified packet (artifacts `00`–`99` in storage).

The v1 runner `scripts/run-pre-research-session.mjs` still exists. Do not use it unless the user explicitly asks for a legacy v1 session.

---

## Ask the user which mode if they did not say

1. **Specific video** — they named a YouTube `video_id`
2. **Next / first / smoke** — oldest eligible qualified video
3. **Resume** — they named a `run_id` (optionally `--research-only` or `--synthesis-only`)

If they said nothing, default to **one smoke video**: `-rsTkYgnNzM` (Rahul Sengottuvelu / Ramp, 2025-03-19, 992s).

Do not use `TRjq7t2Ms5I`. It has a live v1 run (`intent_ready`, run `0af07c2e-bb23-46e1-9661-0a32c67a3715`) and cannot be reclaimed until that run is superseded or applied.

---

## Environment

From `research_starter_pre_research_agent/`:

```bash
test -f .env || cp .env.example .env
```

Required in `.env`:

- `AI_GATEWAY_API_KEY`
- `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do **not** set `EXA_API_KEY`. `web_search` uses Exa through AI Gateway. Do not change `agent/agent.ts` off `zai/glm-5.2`.

---

## Find eligible videos

```bash
npm run list:eligible
```

That prints JSON. Use `first_unprocessed.video_id` only if it is not `TRjq7t2Ms5I`. Claim is 6-arg. `--video-id` cannot bypass qualification.

---

## Start Eve

Use `--no-ui` so the coding session does not attach to the TUI.

```bash
cd research_starter_pre_research_agent
npm exec -- eve dev --no-ui --port 2000
```

Wait for health:

```bash
curl -sS http://127.0.0.1:2000/eve/v1/health
```

Leave this process running. The controller starts both Eve sessions against that server.

---

## Run one video

Default: next oldest eligible.

```bash
npm run pipeline:next
```

Specific qualified video:

```bash
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id -rsTkYgnNzM
```

CLI flags on `scripts/run-pre-research-pipeline.mjs`:

| Flag | Use |
| --- | --- |
| `--next` | Claim the oldest eligible video |
| `--video-id <id>` | Claim that video if it qualifies |
| `--run-id <uuid>` | Resume an existing run |
| `--research-only` | Stop after the research session |
| `--synthesis-only` | Resume synthesis; requires `--run-id` |
| `--approved` | Passed through to the executor apply step |
| `--eve-url` | Eve base URL if not `http://127.0.0.1:2000` |

Related npm scripts: `pipeline:next`, `apply:intent`, `list:eligible`, `test`, `typecheck`.

Do not enable the production schedule. Do not run concurrency 3. Do not backfill v1.

---

## Success criteria

For the video you ran:

- The controller returned two distinct Eve session IDs (`research_session_id` and `synthesis_session_id`)
- Artifacts `00`–`99` exist under `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`
- `pre_research_pipeline_finished` is true only after the intent was applied and the packet hashes verified

Report back: `video_id`, `run_id`, both session IDs, packet prefix, apply status, and whether `pre_research_pipeline_finished` is true.

---

## Failure handling

| Symptom | What to do |
| --- | --- |
| Eve health fails | Restart `eve dev --no-ui --port 2000`; check `.env` |
| `VIDEO_ALREADY_CLAIMED_OR_APPLIED` | Skip; already live or applied. `TRjq7t2Ms5I` is in this state. |
| `NO_ELIGIBLE_VIDEO` | Backlog empty or the named id did not qualify; tell the user |
| Qualification rejected on `--video-id` | Expected. Claim cannot bypass qualification. Pick another id from `list:eligible`. |
| Research or synthesis turn failed | Read `eve logs`. Resume with `--run-id` and the matching `--research-only` or `--synthesis-only` flag. Do not start a third session by hand. |
| Apply refused / review required | Report the refusal. Use `--approved` only if the user asked. |

Do not implement new features during a run unless the user asks.

---

## Out of scope unless asked

- Production schedule
- Concurrency 3
- v1 backfill
- The v1 runner `scripts/run-pre-research-session.mjs`
- The older `research_ingestion_systems_agent`
- Fetching missing transcripts (`transcript_status = none`)
