# Handoff — continue after pre-research v2 code ship

The approved [SCOPE.md](./SCOPE.md) vertical slice is implemented. Do not re-derive the plan. Do not scaffold a new agent. Do not start a second Eve project.

## Read first

1. [index.md](./index.md)
2. [SCOPE.md](./SCOPE.md) — approved 2026-08-16; this mission is **code-complete**
3. [PROGRESS.md](./PROGRESS.md)
4. Operator runbook: [`../HANDOFF.md`](../HANDOFF.md)
5. Plan only if you need a contract detail: [goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md](./goal/PRE_RESEARCH_V2_IMPLEMENTATION_PLAN.md)

## What is done

Qualify → claim → research session (`00`–`50`) → trusted `research_complete` → synthesis session (`60`–`90`) → deterministic apply → `99` receipt → transcript-hash-aware `finished` is wired in TypeScript, Eve tools, and Postgres.

Live GLM/Exa smoke is **validation after this mission**. That is the next action.

## Environment

```bash
cd research_starter_pre_research_agent
test -f .env || cp .env.example .env
```

Required for a live run:

- `AI_GATEWAY_API_KEY`
- `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not set `EXA_API_KEY`. Do not change the model off `zai/glm-5.2`.

Shared DB: Supabase project `wkythqbofmckbuoothhn`.

## Next action

**Run one live v2 smoke video.** Default id: `-rsTkYgnNzM` (Rahul Sengottuvelu / Ramp, 2025-03-19, 992s).

Do **not** use `TRjq7t2Ms5I`. It has a live v1 run `0af07c2e-bb23-46e1-9661-0a32c67a3715` in `intent_ready` and claim will return `VIDEO_ALREADY_CLAIMED_OR_FINISHED`.

```bash
cd research_starter_pre_research_agent
npm exec -- eve dev --no-ui --port 2000
# wait for GET http://127.0.0.1:2000/eve/v1/health
npm run list:eligible
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id -rsTkYgnNzM
```

Or `npm run pipeline:next` if `first_unprocessed.video_id` is not `TRjq7t2Ms5I`.

Success for that run:

- Two distinct Eve session IDs
- Objects under `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/` for `00`–`99`
- Matching Postgres analysis / org / intent / artifact rows
- `pre_research_pipeline_finished = true` only after apply + hash-verified packet

If research completes and synthesis has not started, resume with `--run-id <uuid> --synthesis-only`. Do not start a third Eve session by hand.

## Do not do next

- v1 backfill
- Production dispatcher concurrency 3
- 8-video smoke matrix / golden set / Eve evals
- Enabling the production schedule
- Editing already-applied migrations
- Marking finished from an Eve session
- Writing to aiengineerapp learner/entity tables
- Treating `--video-id` as a qualification bypass

## If you must touch code

Only fix a live-smoke failure. Keep these invariants:

- Claim stays 6-arg: lease, taxonomy, prompt bundle, model, packet schema version, optional video id
- Phase RPCs own `research_complete` / `synthesizing`
- `save_research_phase_packet` must not mark `research_complete`
- `begin_synthesis_session` is the only path into `synthesizing`
- Receipt failure leaves the run unfinalized, not `finished`

Optional leftover, not required for smoke: `agent/tools/touch_pre_research_run.ts` still lists v1 statuses. Leave it unless Eve needs to extend a lease without changing phase.

## Where things live

| Concern | Path |
| --- | --- |
| Eve agent | `research_starter_pre_research_agent/agent/` |
| Zod contracts | `research_starter_pre_research_agent/contracts/` |
| Controller | `research_starter_pre_research_agent/controller/pre-research-pipeline.ts` |
| Executor | `research_starter_pre_research_agent/executor/` |
| Pipeline CLI | `research_starter_pre_research_agent/scripts/run-pre-research-pipeline.mjs` |
| Legacy v1 runner | `research_starter_pre_research_agent/scripts/run-pre-research-session.mjs` (do not use) |
| SQL source of truth | `supabase/migrations/20260816205231_pre_research_v2_schema.sql` |
| Shared DB | Supabase project `wkythqbofmckbuoothhn` |
