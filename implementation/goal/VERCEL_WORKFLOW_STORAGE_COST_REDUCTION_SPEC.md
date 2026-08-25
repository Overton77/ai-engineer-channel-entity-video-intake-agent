# Pre-research workflow storage cost reduction specification

Status: proposed  
Date: 2026-08-23  
Target repository: `research_starter_pre_research_agent`  
Primary goal: remove data-heavy pre-research execution from Vercel Workflow while preserving resumability, correctness, and the existing v2 packet contract.

## Executive decision

The production pre-research batch pipeline must stop using Eve sessions as its stage execution and data-passing mechanism.

Replace the nine Eve stage sessions with a direct, bounded AI SDK stage runner. Use:

- Supabase Postgres for compact orchestration state, leases, attempts, retry timing, artifact manifests, and usage metrics.
- Supabase Storage for large or immutable values, including transcript-reduction checkpoints, stage input snapshots, optional raw provider responses, and the existing twelve validated packet artifacts.
- Vercel Cron and ordinary Vercel Functions only as stateless dispatch/compute. The batch path must not create `workflowEntry`, `turnWorkflow`, or `sessionTimeoutWorkflow` runs.

This is not a request to move the Vercel Workflow journal wholesale into Postgres. Persisting the same event stream in Supabase would relocate the amplification instead of removing it. The replacement must checkpoint once per application stage and must never durably stream token deltas, reasoning deltas, full tool transcripts, or repeated conversation history.

In this document, “object storage” means the existing Supabase Storage service and buckets. Do not add Vercel Blob unless a separate requirement justifies it.

## Diagnosis

### Billing evidence

The Vercel dashboard, filtered to project `research-starter-pre-research-agent` for the current billing cycle, attributed:

| Resource | Project usage | Project charge | Team charge | Attribution |
| --- | ---: | ---: | ---: | ---: |
| Workflow Storage Writes | 48 GB | $24.19 | $24.22 | 99.9% |
| Workflow Storage Retention | 8.66 GB-month | $4.33 | $4.34 | 99.8% |
| Workflow Events | 69.29K | $1.39 | $1.41 | 98.6% |

Workflow writes and retention therefore account for $28.52 of the project's infrastructure charge and are the dominant cause of the bill. Function CPU, memory, queues, and invocations are secondary.

The daily usage chart showed the workflow-related daily charge accelerating across August 20–23 from approximately $0.9 to $3.7 to $9.8 to $9.8 per day. This is ongoing spend, not only old retained data.

Vercel currently bills Workflow Data Written at $0.50/GB and Workflow Data Retained at $0.50/GB-month. Pro workflow state is retained for seven days after completion by default. See [Vercel Workflow pricing](https://vercel.com/docs/workflow/pricing) and [Vercel Workflow limits](https://vercel.com/docs/workflow/limits).

### Runtime evidence

In the last 12 hours, the project created 967 Workflow runs:

- 626 completed
- 224 canceled
- 134 active
- 1 pending
- 0 errored

One logical Eve stage normally creates three durable workflows:

1. `workflowEntry` for the Eve session
2. `turnWorkflow` for the model/tool loop
3. `sessionTimeoutWorkflow` for the session lifetime

The controller creates a fresh Eve session at each of nine application stages and resets completed stage sessions. Resetting retires a session; it does not delete its stored workflow data. The data remains billable for the platform retention period.

A representative synthesis `workflowEntry` retained 16 MB while its corresponding `turnWorkflow` retained 290 KB. By comparison, the most recent 100 completed application runs stored an average of approximately 211 KB of final packet artifacts per video in Supabase Storage; the largest of those runs stored approximately 283 KB. The durable orchestration representation is therefore orders of magnitude larger than the business artifact being preserved.

### Code-level amplification

The current implementation sends large values through the durable Eve boundary in several ways:

- `buildResearchPhaseMessage()` embeds `PRECOMPUTED_VIDEO_CONTEXT_JSON` in the initial durable message.
- `buildResearchContinuationMessage()` embeds all prior registered artifact bodies in `PRIOR_RESEARCH_CONTEXT_JSON`.
- `load_research_phase_packet` downloads multiple full artifacts and returns them as an Eve tool result.
- `save_research_stage_packet` and `save_synthesis_stage_packet` receive full structured artifacts as tool-call arguments.
- Provider-managed `web_search` and `web_fetch` results become durable action results.
- Eve persists cumulative `message.appended` and `reasoning.appended` stream events, finalized messages, tool inputs/results, and step checkpoints.
- Failed steps and recovery turns retain earlier streamed events and add new events with new IDs.

Eve documents that every turn is a durable Workflow, every model/tool loop step is a checkpoint, and workflow state is serialized at each step boundary. Eve also documents that appended text/reasoning events carry cumulative text and that interrupted steps may emit another event sequence. See the installed documentation at `node_modules/eve/docs/concepts/execution-model-and-durability.mdx` and `node_modules/eve/docs/concepts/sessions-runs-and-streaming.md`.

### Root cause

The root cause is an architectural mismatch: Vercel Workflow is being used as a durable transcript and model-tool event store for a high-throughput batch ETL pipeline whose true durable boundaries are only the nine validated application stages.

The five-minute scheduler and 835-video eligible backlog multiply that mismatch. The scheduler is globally serial at the video level, but a video still creates many workflows and many persisted model/tool events. Increasing throughput increases Workflow Data Written almost linearly, while cumulative stream/history serialization can amplify individual stages further.

## Why pointer-only Eve tools are not the final fix

Changing `load_research_phase_packet` to return only a Supabase path would make the tool result small, but the model cannot reason over a path. Some later component must load the artifact bodies and place them in the model request. If that request still runs inside an Eve durable turn, the data still enters Workflow state through the turn input, model history, tool result, or checkpoint.

Pointer-only Eve tools are acceptable as a temporary mitigation, but the completion criterion for this project is that data-heavy stage generation no longer executes inside Vercel Workflow.

## Goals

1. Reduce pre-research Workflow Data Written to effectively zero during normal batch operation.
2. Preserve automatic recovery at the first incomplete application stage.
3. Preserve the existing v2 twelve-artifact packet, hashes, deterministic intent, review policy, and transactional apply behavior.
4. Preserve strict video qualification and transcript-hash protection.
5. Keep large values in object storage and compact queryable state in Postgres.
6. Make every provider call and artifact commit idempotent or safely retryable.
7. Retain the existing project-wide single-worker invariant unless a later design explicitly introduces bounded concurrency.
8. Make operational cost measurable per stage and per video.

## Non-goals

- Do not redesign packet semantics solely for this migration.
- Do not move immutable packet bodies into Postgres JSONB.
- Do not reproduce Eve's token-level event stream in Supabase.
- Do not add a general-purpose workflow engine.
- Do not enable paid model fallback as part of this change.
- Do not delete historical Vercel Workflow runs as part of deployment.
- Do not remove Eve from the repository if it remains useful for operator conversations; only remove it from the automatic batch path.

## Target architecture

```text
Vercel Cron
    |
    v
scheduled-pre-research dispatcher
    |  claim advisory lock + choose run/stage
    v
Supabase Postgres stage ledger -----> compact status, lease, attempts, metrics
    |
    | artifact handles only
    v
stateless stage runner
    |  load required objects just in time
    |  call AI Gateway through AI SDK
    |  validate output with existing Zod contracts
    v
Supabase Storage -------------------> immutable inputs/outputs/raw response
    |
    v
artifact registry + phase transition RPCs
    |
    v
existing deterministic intent executor
```

The process memory of one function invocation may contain the current stage's materialized input and provider response. Those values must not be returned from the Cron handler, written to logs, placed in `waitUntil` results, or stored in a workflow journal.

## Storage model

### Existing authoritative artifacts

Retain the current immutable prefix and registry:

```text
research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/
```

The twelve artifact kinds and `public.research_pre_research_artifact` remain authoritative. Their current uniqueness, SHA-256, byte-count, and cross-file validation rules remain unchanged.

Retain the current transcript-reducer cache objects:

```text
_controller-cache/v2/<video_id>/<run_id>.sections.json
_controller-cache/v2/<video_id>/<run_id>.json
```

### New execution objects

Add a separate non-packet prefix for retryable execution material:

```text
_stage-execution/v1/<video_id>/<run_id>/<stage>/
  input-manifest.json
  input.json
  attempts/<attempt>.response.json        # optional, bounded retention
  attempts/<attempt>.diagnostic.json      # redacted; no secrets
```

Rules:

- `input-manifest.json` contains artifact references and hashes, not duplicate artifact bodies.
- `input.json` is a canonical, stage-minimal materialization used to make a retry reproducible.
- A validated final result is committed to the existing immutable packet path, not kept only under `_stage-execution`.
- Raw response retention must be configurable and short. Default to seven days or less; delete it after a successful canonical artifact commit if it is not required for evaluation.
- Never store API keys, OIDC tokens, authorization headers, or full unredacted error responses.

## Postgres changes

Add `public.research_pre_research_stage_execution` with one row per run and application stage.

Required columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `stage_execution_id` | uuid PK | Stable execution identity |
| `run_id` | uuid FK | Parent pre-research run |
| `stage` | text | One of the nine canonical stages |
| `status` | text | `pending`, `leased`, `retry_wait`, `completed`, `dead_letter` |
| `attempt_count` | integer | Number of claimed attempts |
| `lease_owner` | text nullable | Current invocation identity |
| `lease_token_hash` | text nullable | Hash of opaque lease token; never store raw token in logs |
| `lease_expires_at` | timestamptz nullable | Crash recovery boundary |
| `retry_after` | timestamptz nullable | Provider/backoff eligibility |
| `input_manifest_bucket` | text nullable | Supabase Storage bucket |
| `input_manifest_path` | text nullable | Manifest object path |
| `input_sha256` | text nullable | Canonical materialized input hash |
| `output_artifact_kinds` | text[] | Expected output kinds for this stage |
| `completed_artifact_sha256s` | jsonb | Compact kind-to-hash map only |
| `model_id` | text | Model used for the attempt |
| `prompt_bundle_version` | text | Reproducibility and compatibility |
| `last_error_code` | text nullable | Stable error classification |
| `last_error_detail` | text nullable | Bounded and redacted diagnostic |
| `usage_summary` | jsonb | Input/output tokens, provider, latency; no prompts |
| `started_at` | timestamptz nullable | First start |
| `updated_at` | timestamptz | Scheduling/fairness |
| `completed_at` | timestamptz nullable | Terminal completion |

Constraints and indexes:

- Unique `(run_id, stage)`.
- Validate the nine stage names in a check constraint or enum.
- `attempt_count >= 0`.
- Hash fields must match lowercase 64-character SHA-256 when non-null.
- Index `(status, retry_after, updated_at)` for recovery selection.
- Index `(run_id, stage)` for controller reads.
- Service-role-only access, matching the existing orchestration tables.

Add `public.research_pre_research_stage_attempt` only if per-attempt audit detail cannot fit safely in the execution row. If added, it must contain metadata and object references only, never prompt or response bodies.

### Required RPC behavior

Implement security-definer RPCs or equivalent transactions for:

1. `claim_pre_research_stage(run_id?, worker_id, lease_seconds)`
   - Acquire the project advisory lock or require the caller to hold it.
   - Select the first missing stage using registered artifacts as the authoritative completion signal.
   - Reclaim expired leases.
   - Respect `retry_after` and fairness ordering.
   - Increment `attempt_count` and issue an opaque lease token.

2. `checkpoint_pre_research_stage_input(...)`
   - Record the canonical input manifest path/hash if not already set.
   - Reject a different input hash under the same prompt/schema version unless explicitly superseded.

3. `complete_pre_research_stage(...)`
   - Lock the execution and run rows.
   - Verify the lease.
   - Verify all expected artifact registry rows and hashes.
   - Mark the stage completed and advance the existing run phase when the final research or synthesis stage completes.
   - Be idempotent when the same artifact hashes are supplied again.

4. `park_pre_research_stage(...)`
   - Classify retryable versus terminal errors.
   - Clear the lease, set `retry_after`, and store only bounded diagnostics.

The registered immutable artifact is the completion authority. A stale `leased` row with all expected artifacts present must reconcile to `completed` without regenerating content.

## Stage runner contract

Create a controller-owned stage registry. Each stage definition declares:

- stage name and phase
- required prior artifact kinds
- output artifact kinds
- input builder
- Zod output schema
- allowed tools and exact budgets
- prompt builder/version
- timeout and retry classification
- commit function

The canonical stages remain:

1. `transcript_taxonomy` -> `run_manifest`, `transcript_analysis`, `taxonomy_classification`
2. `web_context` -> `web_context`
3. `organization_research` -> `organization_research`
4. `source_verification` -> `source_verification`
5. `curriculum` -> `curriculum_signals`
6. `initial_summary` -> `initial_summary`
7. `technology_library_summary` -> `technology_library_summary`
8. `organization_profile` -> `organization_profile`
9. `ingestion_intent` -> `ingestion_intent`, followed by the existing deterministic apply/receipt path

### Execution algorithm

For one claimed stage:

1. Load the run and verify the current transcript hash.
2. Resolve required artifact registry rows.
3. Download and SHA-verify only the stage's required objects.
4. Build a canonical minimal input object.
5. Upload or verify the stage `input.json`; record its SHA-256 in the ledger.
6. Call the AI Gateway directly with AI SDK `generateText`.
7. For offline stages, use structured output directly.
8. For online stages, run a bounded tool loop, then perform a separate structured-output generation if the model/provider combination is unreliable when tools and `Output.object()` are combined.
9. Validate the result using the existing Zod and cross-file contracts.
10. Commit artifacts through the existing immutable artifact registry helper.
11. Transactionally mark the stage complete.
12. Return only a compact receipt: run ID, stage, artifact kinds/hashes, status, token counts, and timing.

Do not return materialized artifact bodies from the runner or scheduler.

### Tool policy

Preserve the current network budgets of `0/3/3/2/0` for transcript-taxonomy, web context, organization research, source verification, and curriculum.

Prefer application-owned search/fetch functions that return a bounded normalized evidence record:

```ts
type EvidenceRecord = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  excerpt: string;          // hard character limit
  sourceKind: string;
  retrievedAt: string;
  contentSha256: string;
};
```

Do not place raw HTML, full search-provider payloads, or full page bodies in model history. If a full body is needed for audit, store it in object storage and pass only the bounded extracted evidence to the model.

### Structured output compatibility

AI SDK supports `generateText` with `Output.object({ schema })`; structured output adds a generation step, and tool loops require a sufficient `stopWhen` condition. See the [AI SDK structured output documentation](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data).

Because the deployed model is `zai/glm-5.2`, implementation must prove the selected AI Gateway/provider route supports the chosen structured-output and tool combination. The existing transcript reducer's validated-JSON fallback is an acceptable pattern. Do not assume `generateObject` is reliable for this route without a production probe.

## Scheduler behavior

Keep `pre-research-next` as the production schedule name and preserve the existing `PRE_RESEARCH_SCHEDULE_ENABLED` gate.

The new scheduled handler must:

- run without creating an Eve session
- acquire the existing project-wide Postgres advisory lock
- reconcile completed artifacts before claiming work
- resume retry-ready stages before claiming a new video
- execute a configurable maximum of one to three stages per invocation
- share the existing absolute invocation deadline and stop before Vercel's function limit
- release the advisory lock in `finally`
- log compact structured receipts only

Recommended defaults:

```text
PRE_RESEARCH_MAX_STAGES_PER_INVOCATION=1
PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS=240000
PRE_RESEARCH_STAGE_LEASE_SECONDS=360
PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES=10
```

After proving cost and reliability, throughput may be raised by cadence or bounded stage count. Do not introduce concurrent workers in the first migration.

## Retry and idempotency semantics

- Provider 429, 5xx, DNS/TLS interruption, premature stream termination, and bounded timeout are retryable.
- Schema validation failure is retryable up to a small configured cap and must preserve a redacted diagnostic object.
- Transcript hash mismatch, illegal phase transition, artifact hash conflict, and incompatible prompt/schema version are terminal or require explicit supersession.
- Web-search ledger writes remain atomically budgeted and idempotent.
- Storage upload uses immutable create semantics for packet artifacts. A retry with identical bytes/hash succeeds idempotently; different bytes at the same path is a conflict.
- Never regenerate a stage whose complete registered artifacts pass hash and cross-file validation.
- An invocation crash after object upload but before DB completion must reconcile the object/registry and complete without another model call.

## Required code changes

The implementing agent should expect to change or add the following areas:

- `controller/pre-research-pipeline.ts`
  - remove Eve `Client` and session lifecycle from the automatic pipeline path
  - dispatch direct stage runners and return compact receipts
- `controller/scheduled-pre-research.ts`
  - claim/reconcile stage executions and preserve advisory locking/deadline behavior
- `agent/schedules/pre-research-next.ts`
  - call the stateless controller only; do not create or attach Eve sessions
- new `controller/stages/*`
  - stage registry, input builders, model calls, tool budgets, validation, and commit
- new migration under `supabase/migrations/`
  - stage execution ledger, constraints, indexes, and transactional RPCs
- `agent/lib/artifact-registry.ts`
  - reuse and, if necessary, expose controller-safe immutable commit/reconciliation helpers
- `agent/lib/video-context.ts`
  - reuse the direct AI SDK and validated JSON patterns
- `scripts/inspect-run-session.mjs`
  - replace Eve-session-centric output with stage-execution state while retaining legacy fields for old runs
- `.agents/skills/operate-eve-pre-research/`
  - update operations to the new ledger and remove routine Eve stream inspection from the batch workflow
- tests
  - add stage-ledger, crash-recovery, hash-conflict, retry, budget, and no-Eve-session regression coverage

The Eve agent, tools, and session tables may remain temporarily for legacy runs and operator use. New v3 batch runs must not populate `research_session_id`, `synthesis_session_id`, `workflow_session_id`, or create new `research_pre_research_session` rows. If existing database constraints require those fields, migrate the constraints explicitly rather than inserting fake session IDs.

## Compatibility and versioning

This change alters execution topology but need not alter the v2 packet schema. Use a new prompt bundle/controller version, for example:

```text
packet_schema_version = 2.0.0       # unchanged if artifact meanings are unchanged
prompt_bundle_version = pre-research-v3-stateless-1
stage_execution_schema = 1
```

Recovery policy:

- Completed registered v2 artifacts are reusable after hash verification.
- An unfinished legacy run resumes at its first missing artifact through the new stage runner.
- Legacy Eve session IDs are historical metadata only and must not be attached or reset by the new controller.
- If prompt changes make a partial artifact semantically incompatible, supersede the run explicitly; do not silently mix incompatible artifacts.

## Deployment and cutover

Follow the repository's mandatory architecture-change procedure.

1. Set production `PRE_RESEARCH_SCHEDULE_ENABLED=false`.
2. Redeploy the otherwise-current source.
3. Confirm a later Cron outcome is `disabled`.
4. Allow the old lock-owning invocation to settle within its controller budget.
5. Apply and verify the database migration.
6. Deploy the new stateless controller with the schedule still disabled.
7. Run one controlled end-to-end video and verify all twelve objects, hashes, operations, review policy, and zero new Eve/Workflow runs.
8. Re-enable the schedule, redeploy, observe a real Cron outcome, and audit queue progress and Vercel usage.

Do not cancel or bulk-reset active historical sessions as part of normal cutover. Once no new sessions are created, existing Workflow retention charges should decay as the seven-day retention windows expire.

## Verification plan

### Unit and contract tests

- stage dependency and output-kind mapping
- canonical stage input hashing
- lease claim, renewal/expiry, and stale-worker fencing
- retry-after ordering and fairness
- identical artifact retry versus hash conflict
- reconciliation after object upload and before DB completion
- transcript hash mismatch fencing
- per-stage search budget enforcement
- bounded error detail and secret redaction
- legacy partial-run recovery
- deterministic ingestion intent unchanged

### Integration tests

- direct offline stage with structured output
- direct online stage with exactly bounded search calls
- provider 503/premature termination parks and resumes without duplicate artifact
- function timeout after checkpoint resumes at the same stage
- full nine-stage run produces the same twelve artifact kinds and passes existing cross-file validation
- apply remains transactional and idempotent

### Deployment checks

- `npm run typecheck`
- `npm test`
- `npm run build`
- normal Vercel source build/deploy
- one controlled production video
- canonical `query:pre-research` hash verification
- review-required inspection
- Vercel Workflows view shows no new `workflowEntry`, `turnWorkflow`, or `sessionTimeoutWorkflow` created by the batch run

## Billing acceptance criteria

Measure from the Vercel project-filtered usage dashboard, allowing for its stated reporting delay.

Required:

1. A controlled full video creates zero Eve Workflow runs.
2. Normal scheduled batch operation creates no `workflowEntry`, `turnWorkflow`, or `sessionTimeoutWorkflow` runs.
3. Workflow Storage Writes attributable to the batch pipeline are zero or below 10 MB per completed video during canary, with a target of zero.
4. Supabase Storage bytes added per completed video remain within 2x the canonical packet plus explicitly retained raw diagnostics.
5. Postgres stage-ledger rows remain metadata-sized; no prompt, transcript, page body, search payload, or generated artifact body is stored in JSONB.
6. Queue progress and completion correctness match the current controller.

Operational target after old retention expires:

```text
Workflow Storage Writes: < 0.5 GB/month for this project
Workflow Storage Retention: trends to approximately $0 for batch execution
Workflow Events: no batch-generated events
```

If Eve remains exposed for operator conversations, separate that small interactive usage from the batch metric.

## Rollback

Rollback must not reactivate the high-write path automatically.

- Keep the schedule disabled if the canary fails.
- Preserve every committed artifact and stage-execution row.
- Fix forward and resume from the first missing artifact.
- A source rollback may restore read/inspection compatibility, but must not re-enable Eve batch sessions without an explicit cost decision.
- Do not delete the new ledger or object prefixes during rollback.

## Immediate operational recommendation

Until this migration is deployed, every additional backlog video continues creating high-write durable sessions. The lowest-risk cost control is to pause the production scheduler using the established disable-and-redeploy procedure, allow the current invocation to settle, and leave existing run/session data untouched. This requires an explicit operator decision; it is not performed by this specification.

## Definition of done

The work is complete only when:

- the automatic pipeline contains no Eve client session creation, attachment, streaming, reset, or cancellation
- stage state survives process death through Supabase metadata and immutable objects
- a fresh and a legacy-partial video both complete correctly
- all existing packet, review, apply, and hash invariants pass
- the project-filtered Vercel dashboard confirms the batch path no longer writes Workflow data
- operations and handoff documentation describe the stateless stage ledger as authoritative

