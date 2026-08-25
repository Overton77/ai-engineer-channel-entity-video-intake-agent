# Stateless pre-research v3 handoff — 2026-08-24

## Architecture

The automatic `pre-research-next` batch path no longer creates, attaches, streams, resets, or cancels Eve sessions. Vercel Cron invokes ordinary controller code. Each invocation claims at most one application stage by default, materializes a canonical minimal input under `_stage-execution/v1/`, calls AI Gateway directly through AI SDK when needed, validates the existing v2 packet contract, commits immutable packet artifacts, and completes a compact Postgres stage row.

Packet schema remains `2.0.0`. The controller/prompt bundle is `pre-research-v3-stateless-1`. Existing registered partial v2 artifacts are reused after Storage hash verification; legacy Eve session IDs are historical only.

## Durable sources of truth

- `public.research_pre_research_stage_execution`: status, lease fencing, attempts, retry timing, input pointer/hash, expected/completed artifact hashes, model/version, bounded diagnostics, and token/latency metadata.
- Supabase Storage `_stage-execution/v1/<video_id>/<run_id>/<stage>/input-manifest.json` and `input.json`: reproducible stage inputs.
- Existing `pre-research/v2/<video_id>/<run_id>/` packet objects plus `public.research_pre_research_artifact`: canonical application outputs.
- Existing deterministic ingestion intent/apply/receipt path: unchanged.

No prompt, transcript, provider response body, raw page body, artifact body, token delta, reasoning delta, or tool transcript belongs in the stage ledger.

## Database migration

Migration `20260824011000_stateless_pre_research_stage_execution` was applied transactionally and recorded in `supabase_migrations.schema_migrations`. It creates the metadata table plus service-only ensure/reconcile/claim/checkpoint/complete/park RPCs. A live reconciliation probe converted the three unfinished v2 runs into 27 rows: 12 completed from registered artifact hashes and 15 pending.

## Operating boundary

Always work from this repository and pass `--scope overtons-projects` to Vercel commands. Set `PRE_RESEARCH_SCHEDULE_ENABLED=false` for architecture changes and controlled canaries, then restore it after verification. Source-deploy normally; do not use `--prebuilt` or `npx eve deploy` on this Windows workspace.

Inspect a run:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs <run_uuid>
```

Verify a completed packet:

```powershell
npm run query:pre-research -- --video-id=<video_id> --run-id <run_uuid>
```

Audit the queue:

```powershell
node scripts/list-eligible-videos.mjs --limit 1000 --summary
```

New batch runs must leave `research_session_id`, `synthesis_session_id`, and new `research_pre_research_session` rows empty. Legacy rows are retained for history and are not mutated by normal recovery.

## Cutover verification

Cutover is complete on production deployment `dpl_GF7MyZweYimhD28yKBL5X2PeB23U` (`research-starter-pre-research-agent-1eim3zymy-overtons-projects.vercel.app`). Production now has `PRE_RESEARCH_SCHEDULE_ENABLED=true` and `PRE_RESEARCH_MAX_STAGES_PER_INVOCATION=1`.

The controlled legacy-partial canary for video `yj-wSRJwrrc`, run `5e0178e0-e5db-4ad4-a70c-b78491a984a6`, finished and applied successfully. The verification command listed exactly twelve canonical Storage objects, fetched and SHA-verified all twelve, observed twelve applied intent operations, and confirmed the finished marker. The final intent SHA is `f6ad22815d99d31afffbca867a4f1365888149a136c6289db66069c31786d3c3`.

A production Cron request against the active deployment completed the malformed `curriculum` stage for resumed run `18938647-2dde-4043-a995-045277f2820b` (video `LzeC1AQ-U5o`). The result carried one compact stage receipt and null research/synthesis session IDs. Since the database cutover timestamp, the application session table gained zero rows. The post-cutover database snapshot had 17 completed, 9 pending, and 1 retry-wait stage row, with one fully applied run. Queue audit found 834 unprocessed videos and two recoverable partial runs.

Runtime hardening includes bounded `jsonrepair` fallback before Zod validation and run-scoped taxonomy, prompt-bundle, model, and packet-schema identity when regenerating deterministic intents. This preserves compatibility for partial runs created before v3.

Residual historical note: Vercel logs still showed Workflow traffic from older pinned deployments, not from the v3 deployments. Eight legacy application session rows remain marked `started`: five belong to failed runs, one to the now-applied canary, and two to recoverable partial runs. Direct cancellation was attempted, but the application endpoint rejected it because production Eve authentication is not configured; an OIDC attempt was also rejected by deployment protection. These rows are retained for history and the stateless controller does not resume or create Workflow sessions. Operators should cancel those exact historical Workflow run IDs from an authenticated Vercel/Eve control plane if continued old-deployment activity is observed.
