# Eve pre-research operations

## Fixed deployment identity

- App root: `research_starter_pre_research_agent/`
- Production alias: `https://research-starter-pre-research-agent.vercel.app`
- Vercel project: `research-starter-pre-research-agent`
- Vercel scope: `overtons-projects`
- Schedule: `pre-research-next`, `*/5 * * * *` UTC
- Schedule gate: `PRE_RESEARCH_SCHEDULE_ENABLED`
- Packet schema: `2.0.0`
- Packet prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`

The exact deployment ID can change. Resolve it from the production alias instead of copying an old ID.

## Audit first

Run the canonical queue audit:

```powershell
node scripts/list-eligible-videos.mjs --limit 1000 --summary
```

Interpret the output as follows:

- `count`: untouched videos that currently satisfy every qualification rule.
- `recoverable_count`: unfinished current-schema runs that the scheduler can resume.
- `first_unprocessed`: next claim candidate when no recoverable run is cooldown-ready.
- A changing `artifact_count` or `updated_at` is forward progress.

Inspect production identity and generated routes:

```powershell
npx --yes vercel@latest inspect https://research-starter-pre-research-agent.vercel.app --scope overtons-projects
```

Inspect the authenticated Eve health/info contract without creating a session:

```powershell
node .agents/skills/operate-eve-pre-research/scripts/inspect-deployment.mjs
```

Expected invariants include `status=ready`, workflow `workflow//eve//workflowEntry`, model `zai/glm-5.2`, and schedule `pre-research-next` with `hasRun=true`.

## Start or continue runs

### Normal production drain

If recent queue snapshots advance and Cron outcomes are `completed` or occasional `overlap_skipped`, do nothing. The enabled deployment is already starting/resuming runs. A controller invocation may end at any durable artifact boundary; a later tick continues it.

If the schedule was deliberately stopped and the user asks to resume it:

```powershell
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects
# Enter: true
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects
```

Then inspect the new production deployment, observe a later normal Cron outcome, and rerun the queue audit. Environment updates affect only new deployments.

There is no production one-shot dev schedule route. `/eve/v1/dev/schedules/<id>` exists only under `eve dev`; production start/resume is the Vercel Cron path or a deliberately controlled local controller invocation.

### Deliberately controlled single run

Use this only when the user wants a manual run and production dispatch has first been paused safely:

```powershell
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects
# Enter: false
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects
```

Wait for a Cron outcome of `disabled` and allow up to the 240-second controller budget plus cleanup for an invocation that acquired the advisory lock before the disabling deployment.

Then run one exact durable run against production Eve:

```powershell
$env:EVE_URL='https://research-starter-pre-research-agent.vercel.app'
npm run pipeline:next -- --run-id <run_uuid>
```

Or claim one exact qualified video:

```powershell
$env:EVE_URL='https://research-starter-pre-research-agent.vercel.app'
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id <video_id>
```

`--video-id` does not bypass qualification. Resume production scheduling afterward by setting the flag to `true`, source-deploying, and verifying a real Cron outcome.

For a bounded manual batch, retain the same pause/settle boundary and run serially:

```powershell
$env:EVE_URL='https://research-starter-pre-research-agent.vercel.app'
npm run pipeline:all -- --max-videos 2 --max-transient-retries 5
```

Never run a second worker concurrently.

## View a pipeline run

Inspect compact durable run/session/artifact state:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs <run_uuid>
```

Key fields are run `status`, `artifact_count`, error fields, `latest_session.result_summary.controller_stage`, `delivery_count`, and `eve_session_id`.

Inspect the matching Eve event stream read-only:

```powershell
node scripts/inspect-eve-session.mjs <eve_session_id> https://research-starter-pre-research-agent.vercel.app
```

With no fourth argument this performs a bounded authenticated read from the durable stream. A fourth argument mutates state: `--reset` retires the session and a turn ID requests cancellation. Do not supply either during normal operation.

Inspect recent production requests and structured schedule messages:

```powershell
npx --yes vercel@latest logs --project research-starter-pre-research-agent --environment production --scope overtons-projects --since 30m --limit 300 --source serverless --expand
```

In the Vercel UI, use **Settings → Cron Jobs** for discovery, **Observability → Cron Jobs** for delivery history, **Observability → Logs** filtered by `[pre-research-schedule]` for outcomes, and **Observability → Agent Runs** when enabled for Eve session traces.

An isolated `overlap_skipped`, provider HTTP 503, terminated stream, 403 page, redirect, or controller `waiting` result is recoverable. Escalate only after durable state stops advancing across several eligible ticks.

## Verify a completed run

Use the existing verification skill and script; do not reimplement its SQL:

```powershell
npm run query:pre-research -- --video-id=<video_id> --run-id <run_uuid>
```

A complete automatic result has `run_status=applied`, `intent_status=applied`, `finished=true`, exactly twelve packet objects, successful retrieval and hash verification for every object, and twelve applied operations.

Inspect genuine review items separately:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-review-required.mjs
```

## Interact with the deployed Eve app

For an operator conversation that creates its own root session, connect the Eve TUI:

```powershell
npx eve dev https://research-starter-pre-research-agent.vercel.app
```

Run `/vc:login` if Vercel OIDC access needs refreshing. Use `/help` for TUI controls and `/exit` to disconnect. Remote TUI connection does not alter the local Vercel link or `.env.local`.

Do not use a new conversational session as a substitute for the pipeline controller. The controller creates stage-scoped sessions with trusted run metadata and tool boundaries. To interact with an existing pipeline stage, prefer read-only stream inspection and let the controller resume it.

The wire-level deployment interfaces are:

- `GET /eve/v1/health`: readiness, no session creation.
- Authenticated `GET /eve/v1/info`: model/capability/schedule inspection.
- `POST /eve/v1/session`: create a durable conversation session.
- `POST /eve/v1/session/<session_id>`: send a follow-up to that exact session.
- `GET /eve/v1/session/<session_id>/stream`: NDJSON durable event stream.
- `POST .../cancel`, `.../compact`, `.../clear`, `.../reset`: mutating controls; not routine pipeline operations.

Use `scripts/eve-client.mjs` for production authentication. Its Vercel OIDC callback refreshes credentials and sets redirect handling safely.

## Pause production safely

Only pause when the user requests it or architecture work requires it:

```powershell
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects
# Enter: false
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects
```

Confirm a later `disabled` outcome and let any prior invocation settle. Do not cancel Eve sessions or mutate orchestration rows. Before deploying incompatible topology, prompt, tool, packet, recovery, or database-write changes, follow the full eight-step architecture-change procedure in the handoff and version incompatible packet semantics.
