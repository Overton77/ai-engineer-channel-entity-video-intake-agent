# Eve pre-research operations

## Fixed deployment identity

- App root: `research_starter_pre_research_agent/`
- Production alias: `https://research-starter-pre-research-agent.vercel.app`
- Vercel project: `research-starter-pre-research-agent`
- Vercel scope: `overtons-projects`
- Schedule: `pre-research-next`; source declares `* * * * *` UTC, while the current Vercel output compiles to the effective `*/5 * * * *` cadence
- Schedule gate: `PRE_RESEARCH_SCHEDULE_ENABLED`
- Packet schema: `2.0.0`; controller/prompt bundle: `pre-research-v3-stateless-slim-62`
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

Inspect compact stage execution state (legacy session fields remain visible for old runs):

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs <run_uuid> --summary
```

Expected invariants include nine ordered stages, metadata-only usage/error fields, immutable input manifest paths, and no new batch session IDs. Omit `--summary` only when the full immutable manifest and artifact-hash detail is needed.

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

Vercel Cron is a wakeup mechanism, not a daemon. Each invocation can disappear after its time limit. A later invocation safely resumes because the authoritative state is the Postgres run/stage ledger and immutable objects under the packet prefix. The v3 automatic controller creates no Eve sessions or sandboxes.

### Deliberately controlled single run

Use this only when the user wants a manual run and production dispatch has first been paused safely:

```powershell
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects
# Enter: false
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects
```

Wait for a Cron outcome of `disabled` and allow up to the 240-second controller budget plus cleanup for an invocation that acquired the advisory lock before the disabling deployment.

Then run one exact durable stateless run from the controlled operator environment:

```powershell
npm run pipeline:next -- --run-id <run_uuid>
```

Or claim one exact qualified video:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/run-pre-research-pipeline.mjs --video-id <video_id>
```

`--video-id` does not bypass qualification. Resume production scheduling afterward by setting the flag to `true`, source-deploying, and verifying a real Cron outcome.

For a bounded manual batch, retain the same pause/settle boundary and run serially:

```powershell
npm run pipeline:all -- --max-videos 2 --max-transient-retries 5
```

Never run a second worker concurrently.

For a full time-limited local drain, use:

```powershell
npm run pipeline:all -- --max-transient-retries 5
```

The batch discovers every live packet-`2.0.0` recovery across prompt bundles, skips a video only after a current-prompt run exhausts its bounded stage retry series, defers genuine `review_required` packets, and continues in oldest-qualified-video order. The host must remain powered on and awake. If the process exits, run the same command again; it resolves durable live runs before claiming new work. An older run whose immutable input digest is incompatible with current source may terminalize without another model call; prompt-scoped failure exclusion then permits a fresh current-prompt run for that video.

Expected `video_deferred_for_review` events are informational and belong on stdout. Reserve stderr for invalid arguments, transient retry parking, exhausted failures, and unexpected batch stops. Older drain log files may contain historical review-deferral lines on stderr from before this routing correction; inspect the event name before treating a nonempty file as a worker failure.

For an unattended Windows drain, `scripts/watch-local-drain.ps1` can adopt an already-running worker or start one. It holds a Windows system-awake request, gives long local transcript reductions a 30-minute stage lease, and stops after a clean queue-exhausted exit. It restarts a child that exits nonzero. It also treats 40 minutes without a completed-video stdout event as a stalled worker, terminates that worker only after its 30-minute lease is reclaimable, and restarts the drain. Keep production dispatch disabled for its entire lifetime. Override `-StallTimeoutSeconds` only when a known single-video runtime exceeds 40 minutes, and keep it greater than `PRE_RESEARCH_STAGE_LEASE_SECONDS`.

For a source-version handoff during a healthy drain, `scripts/stop-local-worker-after-result.ps1` requests a cooperative stop from one exact worker after one exact video/run pair appears as a durable `video_result`. Pass the validated worker/watchdog PIDs, current stdout path and byte offset, and exact IDs. The worker consumes the PID/video/run-scoped request before its next claim iteration and exits with the watchdog restart code; the script retains a bounded force-stop fallback only for older workers that predate cooperative signaling. It revalidates parentage and command identity before mutation; timeout, identity change, or early worker exit performs no stop. The watchdog then starts exactly one child from current source. Never use a broad process-name kill or stop an in-flight stage merely to load newer source.

If a pre-cooperative boundary fallback already killed a worker after it leased the successor stage, wait for natural lease expiry unless throughput is time-critical. An early release is allowed only for the exact pre-checkpoint empty lease after proving the lease-owning PID is dead, the owner string matches, the stage has no input manifest, no registered or Storage output object, and no intent. Dry-run first, then confirm:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/release-orphaned-empty-stage.mts <run_uuid> <stage> --expected-owner <owner> --dead-worker-pid <pid>
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/release-orphaned-empty-stage.mts <run_uuid> <stage> --expected-owner <owner> --dead-worker-pid <pid> --confirm
```

Live packet-`2.0.0` recoveries deliberately cross prompt-bundle versions. A source deployment must not strand an in-flight compatible run merely because newer videos use a new prompt bundle. Failed-run exclusion remains prompt-version-specific; live recovery does not. The database claim function must include the predecessor-completed guard from migration `20260825022000_pre_research_stage_dependency_guard.sql`.

An exact empty-output dead-letter may be requeued only after confirming that no registered or Storage artifact exists for that exact stage:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/requeue-empty-stage.mts <run_uuid> <stage> --confirm
```

Do not use this to overwrite an immutable artifact or to bypass a genuine validation/review outcome.

A `review_required` packet with a proven semantic defect may be reopened only when it remains the exact latest non-finished review, its intent is validated with zero apply events, and no competing run exists. Dry-run first, then confirm with the identical reason:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/supersede-review-run.mjs <run_uuid> --reason "<proof-quality audit reason>"
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/supersede-review-run.mjs <run_uuid> --reason "<same reason>" --confirm
```

This rejects only the old unapplied intent, preserves its immutable packet, and lets a fresh current-prompt run be claimed. Never use it to bypass genuine hierarchy ambiguity or a truly organization-less result.

An already-applied packet with a proven semantic defect may be reopened only when it is still the exact latest finished run, its applied intent has all twelve events, and no competing run exists. Dry-run first, then confirm with the same audit reason:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/supersede-applied-run.mjs <run_uuid> --reason "<proof-quality audit reason>"
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/supersede-applied-run.mjs <run_uuid> --reason "<same reason>" --confirm
```

This preserves the old immutable packet, intent, and apply events; it marks the run superseded and reopens only the completion projection so the sole worker can create a fresh current-prompt run. Never use it for preference changes or to rewrite historical evidence.

## View a pipeline run

Inspect compact durable run/stage/artifact state:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs <run_uuid>
```

Key fields are run `status`, `artifact_count`, `stage_executions[].status`, `attempt_count`, `retry_after`, input hash/path, artifact hashes, usage, and bounded diagnostics. `latest_session` and Eve IDs are legacy-only.

Only for a historical legacy run, inspect the matching Eve event stream read-only:

```powershell
node scripts/inspect-eve-session.mjs <eve_session_id> https://research-starter-pre-research-agent.vercel.app
```

With no fourth argument this performs a bounded authenticated read from the durable stream. A fourth argument mutates state: `--reset` retires the session and a turn ID requests cancellation. Do not supply either during normal operation.

Inspect recent production requests and structured schedule messages:

```powershell
npx --yes vercel@latest logs --project research-starter-pre-research-agent --environment production --scope overtons-projects --since 30m --limit 300 --source serverless --expand
```

In the Vercel UI, use **Settings → Cron Jobs** for discovery, **Observability → Cron Jobs** for delivery history, **Observability → Logs** filtered by `[pre-research-schedule]` for outcomes, and **Observability → Agent Runs** when enabled for Eve session traces.

An isolated `overlap_skipped`, provider HTTP 503/429, terminated stream, or `retry_wait` stage is recoverable. Escalate only after ledger and artifact state stop advancing across several eligible ticks.

## Verify a completed run

Use the existing verification skill and script; do not reimplement its SQL:

```powershell
npm run query:pre-research -- --video-id=<video_id> --run-id <run_uuid>
```

A complete automatic result has `run_status=applied`, `intent_status=applied`, `finished=true`, exactly twelve packet objects, successful retrieval and hash verification for every object, and twelve applied operations.

Inspect genuine review items separately:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-review-required.mjs <run_uuid>
```

## Interact with the deployed Eve app

For an operator conversation that creates its own root session, connect the Eve TUI:

```powershell
npx eve dev https://research-starter-pre-research-agent.vercel.app
```

Run `/vc:login` if Vercel OIDC access needs refreshing. Use `/help` for TUI controls and `/exit` to disconnect. Remote TUI connection does not alter the local Vercel link or `.env.local`.

Do not use a new conversational session as a substitute for the pipeline controller. The batch controller is stateless and uses leased Postgres stage rows plus immutable Storage inputs; operator conversations are entirely separate.

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
