# Pre-Research v2 continuation handoff — 2026-08-21

## Executive status

The pre-research pipeline is now a bounded, resumable, serial v2 workflow for AI Engineer YouTube videos. It enforces the strict duration requirement, iteratively reduces transcripts before Eve sees them, produces and validates twelve durable packet objects per completed run, applies a deterministic twelve-operation intent to Supabase Postgres, and verifies the matching object hashes in Supabase Storage.

The production Eve project is linked to the `overton77` Vercel account under the team scope `overtons-projects`:

- Vercel project: `research-starter-pre-research-agent`
- Project ID: `prj_DCbyEyiaPwh2U7dD8odSnJlLcVMY`
- Team/org ID: `team_5icKZ1SjQXFuTNwc6sXXDscB`
- Production alias: <https://research-starter-pre-research-agent.vercel.app>
- Production alias health: `{"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}`
- Framework preset: Eve
- Node.js: 24.x
- Current production deployment: `dpl_6y1p6jCqaSFB8SC6F47Jo7eYGkif`
- Current immutable deployment URL: <https://research-starter-pre-research-agent-8iba6ehky-overtons-projects.vercel.app>
- Last deployment inspection: `2026-08-23T14:56Z`, target `production`, status `Ready`

A native Eve schedule is included at `agent/schedules/pre-research-next.ts`. It is compiled into a Vercel Cron Job at `*/5 * * * *` (every five minutes, UTC), is controlled by `PRE_RESEARCH_SCHEDULE_ENABLED=true`, and holds a project-wide Postgres advisory lock to prevent overlapping dispatches. It resumes the least-recently-dispatched retry-ready current-schema run before claiming another video and processes at most one pipeline per dispatch. A dispatched run receives a durable `updated_at` fairness marker and normally cools down for ten minutes; if every unfinished run is cooling down, the intervening tick can claim another qualified video. This preserves strictly serial execution while preventing one provider-stuck video from starving the whole backlog. The schedule passes an absolute 240-second controller deadline across every stage in the invocation, leaving one minute for cleanup and advisory unlock below Vercel's 300-second runtime limit. Each stage is independently durable and a later tick resumes at the first missing artifact.

## Requirements implemented

### 1. Strict video eligibility

The canonical eligibility rule is now:

```text
transcript_status = stored
transcript bucket/path/text all present
non-empty transcript text
matching Supabase Storage object exists
duration_seconds > 0
duration_seconds < 5400
```

Exactly 5,400 seconds (1:30:00) is rejected. Missing and non-positive durations are rejected with distinct ineligibility reasons. Selection, claiming, recovery, and scheduled recovery all use the same rule.

### 2. Transcript context protection

Every transcript is split into contiguous 12,000-character sections. The GLM 5.2 reducer receives:

1. the current bounded section;
2. the structured cumulative result from the previous section; and
3. compact instructions and video metadata.

Each reducer result is schema validated and fed into the next call. After every successful section, the rolling result is durably checkpointed in Supabase Storage at `_controller-cache/v2/<video_id>/<run_id>.sections.json`. Recovery validates the video, run, transcript hash, chunk size/count, and completed-section count, then skips already reduced sections. The final compact `PRECOMPUTED_VIDEO_CONTEXT_JSON` is cached at `_controller-cache/v2/<video_id>/<run_id>.json` and supplied to Eve; raw transcript text is not placed in Eve's agent context or research packet. Transient gateway, malformed structured-output, empty-summary, and network/TLS failures are retried. Both cache objects live outside the immutable twelve-object packet prefix.

This is production-proven on the 4,502-second (75:02) workshop `il1c1a2FufU`, run `826bb7c2-e534-445e-8c2b-10576a29a8c8`. It passed the strict `< 5,400` duration gate, split into six 12,000-character chunks, and persisted a schema-valid checkpoint with `completed_chunk_count=6` of `chunk_count=6`, matching video ID, run ID, and transcript SHA-256 `822130d7b5b2882c6fc1e1691efe49f13f389e4de0e5aa6d850b6bea6e189767`. Its final compact cache reports `strategy=iterative_rolling_summary`, `chunk_count=6`, and `raw_transcript_returned=false`. It finished `applied` with all twelve packet objects retrieved and hash-verified, all twelve operations applied, and matching transcript SHA. This is the strongest end-to-end proof of the large-transcript path.

### 3. Sandbox and subagent efficiency

The former model-authored fan-out was removed. A video runs through nine controller-owned stages serially:

1. transcript and taxonomy (`00`, `10`, `20`)
2. web context (`30`)
3. organization research (`35`)
4. source verification (`40`)
5. curriculum signals (`50`)
6. initial summary (`60`)
7. technology-library summary (`70`)
8. organization profile (`80`)
9. deterministic ingestion intent (`90`)

Each stage gets one isolated root Eve session. Subagents, the Workflow orchestration tool, sandbox shell/file tools, and broad dynamic tool access are disabled. A transient provider error parks the current stage session. Recovery persists the controller-owned phase/stage identity and delivery count in the existing session `result_summary` column, then reuses that Eve session only if it still matches the first missing artifact and has fewer than 18 deliveries. This avoids replaying an unbounded Eve stream merely to decide whether a session is reusable. Legacy sessions receive one bounded first-message/tail inspection and are upgraded to the Postgres record. Current boundary and pending-input inspection reads at most 64 tail events with an abortable idle cutoff. Stage changes and mismatches always get a clean root session.

If a retry or checkpoint nudge cannot be delivered, the controller returns `waiting` immediately. A controller invocation has a 120-second per-stage wait budget (`PRE_RESEARCH_CONTROLLER_STAGE_WAIT_MS`, allowed range 15–240 seconds) and the production scheduler gives the whole invocation an absolute 240-second budget (`PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS`, allowed range 60–270 seconds). Every stage wait uses the earlier deadline, and no new isolated stage is created after the invocation deadline. Eve remains durable and is not cancelled, while the scheduler retains enough time to release its advisory lock before Vercel's 300-second kill.

The AI SDK already performs three provider attempts for each Eve delivery. The controller therefore permits only one additional parked-turn delivery per Cron tick. This prevents a Blackbox outage from being multiplied into a rapid burst of model requests while preserving automatic recovery at the next five-minute boundary.

Network tools are stage-scoped. The framework's built-in `web_fetch` is globally disabled, then dynamically restored only for `web_context`, `organization_research`, and `source_verification`; it is unavailable during transcript/taxonomy and synthesis stages. The production AI Gateway request for the active transcript stage was inspected and contained no `web_fetch`, closing the capability gap that had allowed an unnecessary 429-producing fetch. Eve 0.38.x requires its provider-managed `webSearch()` definition to be static; attempting to return it from `defineDynamic` causes a runtime `kind without defineTool()` resolver error. `web_search` therefore remains statically visible, but prompts forbid it in offline stages and accounting is enforced independently of model-supplied labels: the recorder derives the active stage from Eve messages, maps it to the only valid ledger label, and atomically serializes duplicate/count/insert under a per-run/per-stage Postgres advisory lock. Budgets are 0/3/3/2/0 for transcript-taxonomy, web context, organization research, source verification, and curriculum. The final intent path uses the same lock and limits. The scheduler adds a project-wide advisory lock, so a second cron tick exits as `overlap_skipped` instead of creating another set of sessions.

Vercel's `/var/task` is read-only at runtime and its ephemeral filesystem may report effectively no free disk. The controller skips local disk-headroom checks on Vercel, and artifact persistence skips host writes there while continuing to treat Supabase Storage plus the Postgres registry as authoritative. Local execution retains both safeguards and host output.

Docker was inspected during this work. No Eve containers were running after local execution stopped. The many `eve-sandbox-template` image tags mostly share the same approximately 583 MB layer set; they are tags/build generations, not eight simultaneously running containers or eight full independent copies. No Docker images were deleted.

### 4. Durable Supabase ingestion

The pipeline saves twelve immutable JSON objects under:

```text
research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/
```

The final ingestion intent contains twelve allowlisted operations in a deterministic order. Application is transactionally serialized with an advisory lock, respects foreign keys, normalizes and deduplicates domain codes, writes the execution receipt and finished marker, and records hashes in the artifact registry. Re-running apply is idempotent.

Legacy packet-schema runs are superseded before a current v2 claim. Interrupted current v2 runs are recovered before new videos. Actual unresolved organization ownership/hierarchy conflicts remain review-gated; verified post-video acquisitions, ownership changes, publication-date discrepancies, and technology-name issues are advisory metadata rather than automatic blockers.

Review classification now has one shared deterministic policy in `contracts/review-policy.ts`. The final synthesis save tool, controller fallback, and executor all apply the same confidence, primary-organization, candidate-set, authoritative-source, domain, and hierarchy rules. `review_reasons` blocks only when it contains both a hierarchy topic and explicit uncertainty language; every hierarchy topic in `unresolved_conflicts` blocks because that field is unresolved by contract. This distinction fixed a production loop where two Arize packets described verified post-video changes but were repeatedly refused as if the identity were ambiguous.

Organization sources are now filtered against the packet's candidate IDs before immutable profile creation, and the executor repeats the same parent-existence filter defensively. A production packet exposed one Dynatrace press-release source carrying a fabricated placeholder candidate UUID even though Dynatrace was not in that packet's candidate set. The transaction correctly rolled back on the foreign key. The valid candidate set and primary Arize authoritative-source minimum remained intact, so dropping only the unusable orphan row preserves the packet's supported analysis while preventing a single invalid child row from aborting all twelve operations. Regression coverage asserts the exact filter behavior.

Migration `supabase/migrations/20260822234000_allow_intent_review_reclassification.sql` extends the existing allowed `research_private.complete_synthesis_phase` orchestration function with one defensive transition: `intent_ready -> review_required`. The controller uses it only if the executor discovers a late deterministic blocker. This prevents a future mismatch from remaining `intent_ready` and being retried every cooldown. The migration was applied directly and version `20260822234000` was marked applied; a blanket `supabase db push` was deliberately avoided because this workspace has older local/remote migration-history divergence.

## Important implementation files

- `agent/lib/iterative-transcript.ts` — sectioning and rolling-summary contracts
- `agent/lib/video-context.ts` — transcript loading, iterative GLM reduction, retry classification
- `agent/lib/ai-gateway-dns.ts` — opt-in hostname-scoped local DNS/IP override
- `agent/lib/stage-network.ts` — allowlist for stages that may fetch web pages
- `agent/tools/web_fetch.ts` — disables Eve's framework-wide fetch definition
- `agent/tools/stage_network.ts` — dynamically restores fetch only for online research stages
- `controller/pre-research-pipeline.ts` — serial staged controller and recovery
- `controller/stage-session.ts` — durable stage identity and bounded same-session recovery guard
- `controller/scheduled-pre-research.ts` — schedule enable gate, advisory lock, recovery-first dispatch
- `agent/schedules/pre-research-next.ts` — Eve/Vercel cron definition
- `contracts/review-policy.ts` — shared deterministic synthesis/apply review policy
- `executor/apply-intent.ts` — deterministic transactional apply using the shared review policy
- `scripts/eligible-videos.mjs` — canonical eligible and recoverable queries
- `scripts/run-all-pre-research-pipelines.mjs` — recovery-first local drain with transient retry parking
- `scripts/list-eligible-videos.mjs` — compact backlog audit (`--summary`)
- `scripts/query-pre-research.mts` — database/storage/hash verification
- `scripts/inspect-run-session.mjs` — run/session/artifact checkpoint inspection
- `scripts/inspect-review-required.mjs` — review queue inspection
- `scripts/supersede-review-run.mjs` — guarded supersession of an invalid, unapplied review packet while preserving its immutable objects
- `tests/iterative-transcript.test.mts` and `tests/review-conflicts.test.mts` — regression coverage

## Verified production proof runs

These runs completed with twelve registered objects, a twelve-operation intent, a transactionally applied receipt, a finished marker, and matching storage hashes:

| Video ID | Run ID |
|---|---|
| `Owb8g3yDyzo` | `97f23f98-de3c-4f8d-8dee-8509fe3ea14b` |
| `Tt2kX2sgQio` | `aaf33572-7b17-46b9-aa69-f0b8fc24df54` |
| `vW8wLsb3Nnc` | `9e9027ce-533c-4a4f-b799-e352fe27fdab` |
| `a4BV0gGmXgA` | `f9f6a870-2aa9-45bd-9276-9677ae2e3a80` |
| `CEvIs9y1uog` | `296363d2-1483-471e-bc87-d41b52e50ce4` |
| `TRjq7t2Ms5I` | `a9322e93-4e3b-4e9c-9797-b9b0363449b5` |
| `X4dEHRzBLmc` | `b803fa4c-21b4-4090-9d53-2f392ea01a7b` |
| `KhYifX22yhE` | `20f7228e-0214-4706-aede-e1c068ca807b` |
| `Yk87oUPVaxU` | `0419430d-84a5-4f10-a900-b0cf665aa492` |
| `CgsWxRUY5Eo` | `bd72b0d3-d8ff-4377-934b-da823df56179` |
| `lyL5QhgIOxc` | `61ad40e6-18ee-4f05-a537-8ee0e67bc944` |
| `KwhgfwOSToQ` | `7a323b44-f715-4fd8-a173-c3c61e081281` |
| `1OMHGsUZiqA` | `1993d270-c312-42c6-97db-e2abab52a4ce` |
| `7wu2hsRfvV0` | `d6a22590-669b-492c-be46-4b7e4be0b4c1` |
| `ITMXwI6QL6A` | `da3649e9-bbab-44c2-9675-83a769cfeec3` |
| `RVxym6mmIns` | `2690fadd-8750-4f06-b9ae-d668c26ace38` |
| `Byv311hdoHE` | `b6a137ef-a6ae-4bb9-adba-efbe621481c5` |
| `l0FLhNqBOic` | `10beaf07-c4c3-4184-8256-20043878d723` |
| `GgLQ02aO-hs` | `8f5d9af6-26ae-423e-9500-f1a8b53e2817` |
| `cO8qC6HBuBg` | `2ad35bcc-9722-4add-8001-b0450453fe25` |
| `O-CBZ3JtRvo` | `e7cf3d8d-b0f5-470a-acba-e6e47140cdf7` |
| `il1c1a2FufU` | `826bb7c2-e534-445e-8c2b-10576a29a8c8` |
| `jRCpXUjz4CI` | `e55c962e-39c7-432d-9add-338590e556c8` |
| `xyL2Ltkh-SA` | `c16d8c21-12aa-4efb-abf4-b1b6f36f7fe9` |
| `q2JrUKBMf0w` | `93ab05ca-5053-488f-928d-443bf26625e5` |
| `9HbzAWnKbo4` | `c5020dc6-6653-4a9b-aa18-2d317b95aaa7` |
| `31GUkCBD-Uc` | `5d60c4bf-b228-4a88-a2f9-2662276e192c` |
| `b_PmGocP4rc` | `fbc0bd3c-33b3-4333-98b0-68022ef87b70` |
| `Ib5t2RLtxvM` | `4e5c6db3-7285-4f73-bcaf-3a474830ffbc` |
| `hacEQHHhu2Q` | `bf0a272a-af20-4df9-b714-6cdf79e1fab3` |
| `xIt_mTQp6mY` | `576f4530-cbc6-4bdf-97a8-c645a81a1917` |
| `wpOA-UXynoM` | `4cf4739c-68b3-4bae-92f5-98ff7f6fca52` |
| `BInpv7lGp1o` | `9a711437-2ca9-4c00-b423-c27c844de9da` |
| `O72p-rBb2bA` | `67435e8b-ac1f-49bc-b483-febf3a814127` |
| `kiqubc5b5Yo` | `2628769c-d351-4dec-8019-21f7bab72a28` |
| `KMR_RBoCa4M` | `8b0065da-aa1f-4805-a2b4-ce14c10d3bf6` |
| `7jjudsEhBtM` | `a196bc04-36bd-469c-9970-6df3fe482c38` |
| `YnNF55QV0zs` | `dbec0613-e2b0-4cf0-a574-60641f7ecc53` |
| `iKQ78wyJEXU` | `0a66f53c-5105-4d9a-86cb-d3e246896a17` |
| `s67bE2Ur3bY` | `afb19547-afed-435a-a53f-68175b56cbbb` |
| `o6U_2vd967Y` | `20de9ea3-4386-4635-8611-7d08304cb885` |
| `tJFjeMBKbIY` | `9573ef99-38e6-44b9-b211-875f8d66a810` |
| `z0sh8HyTrDo` | `13ad277f-1e6c-4ce7-a71e-5ac0fc5f1a0d` |
| `pWXUkLP9uWM` | `55c86923-b0a3-419c-8212-b59c1dad734a` |
| `AMiyLItEtLA` | `8178aeeb-aa33-4f83-aa8c-520a02f1781c` |
| `AVMr9PMINyo` | `c99b8675-1414-4638-9689-e52ec971637a` |
| `AQv3qRCG6Gw` | `389a656b-1ae3-48f2-a607-7e18c8df62b0` |
| `jWq-aZIU0kM` | `d2ca6922-79f5-4896-b6e8-341259a03bc0` |
| `lCBf9slCanI` | `c94afb6a-457c-4202-9a9d-b87f3cbe6c18` |
| `xbPriQWXtWM` | `5d048c95-e108-4f60-94ed-5c76a857c4b5` |
| `3ZMUiFaQ3qg` | `7875057c-1625-477b-8008-fa05a9f9c869` |
| `zkX03APVj0M` | `8c1d179c-a4ca-4787-89a4-a5b724485e68` |
| `2bvtay8wGYI` | `7c9f0422-90be-4489-8880-696e4f6dce2b` |
| `QHBjufYK8TA` | `547b6c46-0f63-473d-a7ec-d4d840b81bda` |
| `J4_jCrTxMkk` | `89af43c3-f0f5-4af3-a7ca-dba44d66f106` |
| `CoEIs6Xm8m8` | `5e18d312-252f-42ed-b38e-903f276528f5` |
| `LZuWZRze3MU` | `d5daeefb-d1b0-4984-9a24-3040ddd263d9` |
| `FWMJQDH3iK0` | `3453d6f1-8613-443a-896d-79bc3733b018` |
| `Z-c11pV_uvU` | `d44aa9c2-b137-4778-bf8c-28c0e1038170` |

The final run and backlog audit from this handoff are recorded in the “Final verification snapshot” section below.

One additional full research/synthesis packet was deliberately not applied:

| Video ID | Run ID | Result |
|---|---|---|
| `ZyIoTOAbRfs` | `0b7dfea6-0ca6-48a5-bc32-3853db185384` | `review_required`; 11 immutable pre-apply artifacts, genuine stealth-company identity conflict, zero database apply operations |

## Eve framework architecture learned during this work

This section distinguishes Eve's general execution model from this project's deliberately narrower use of it. That distinction explains the Docker behavior, the absence of subagent fan-out in production, and how a live run survives several Vercel invocations.

### Filesystem-first compilation

Eve compiles capabilities from conventional files under the root `agent/` directory. Agent definitions, tools, schedules, workflows, and related slots become generated HTTP/workflow routes at build time; the capability name is derived from its file path. The root agent in this project is `agent/agent.ts` and currently declares `zai/glm-5.2`, low reasoning, compaction at 35%, a 300,000-token session input ceiling, a 32,000-token output ceiling, and a 24-hour session timeout. Those ceilings are safety limits, not a reason to inject a raw transcript: the controller always produces the bounded iterative transcript context first.

The schedule is code, not a model-authored Markdown task. `agent/schedules/pre-research-next.ts` is a root `defineSchedule` with the five-field UTC expression `*/5 * * * *`. Its handler calls `waitUntil(runScheduledPreResearchOnce())`, logs the structured outcome, and propagates errors. A Vercel build converts that definition into the framework routes, Vercel Workflow configuration, and Vercel Cron configuration. `eve dev` exposes a local one-shot schedule route but does not run the recurring cadence; `eve start` does run schedules. Production cadence is Vercel Cron.

### Sessions, turns, steps, and durable replay

An Eve session is the durable conversation. A turn begins with one delivered message. A step is one model call plus any associated tool calls. On Vercel, Eve uses Vercel Workflow to checkpoint step boundaries. A process restart, function timeout, or redeployment therefore does not imply that the logical session is lost.

Completed workflow steps replay their recorded results. An interrupted step can run again, and retry-generated stream events can receive new IDs. Authored tools and external writes must consequently be idempotent. This project adds stronger application-level durability: run identity, stage identity, session ID, transcript hash, immutable artifact paths and hashes, intent operations, apply events, receipt, and finished state live in Postgres/Supabase rather than depending on the model stream.

Existing sessions survive a redeploy. On their next model turn they use the current deployment's agent instructions, model, and available tools, while earlier user-role messages remain in session history. This is useful for compatible fixes but dangerous during an incompatible architecture or packet-contract change. Pause dispatch before such a deployment and version the contract rather than allowing an old session to resume silently under different semantics.

### Streaming behavior and why this controller does not replay everything

Eve exposes durable NDJSON event streams. Event `meta.id` is stable across ordinary reconnect or rewind, but a retried interrupted step may emit replacement events with new IDs. A true tailing read requires `follow: true` and a negative start index; bounded catch-up uses `follow: false`, and tail indexes should be treated explicitly.

This controller does not reconstruct pipeline state by replaying an entire long stream. It stores a compact controller-owned stage name and delivery count in the session's existing `result_summary`, bounds tail inspection, and treats the Supabase artifact registry as the stage-completion authority. A session is reused only when its recorded stage matches the first missing artifact and its delivery count is below the configured guard. Otherwise the controller starts a clean root session for that stage.

### Sandboxes, Docker images, and subagents

Eve gives an agent one logical sandbox by default, but the sandbox is created or reused only when a sandbox-backed capability is invoked. Built-in shell/read/write/glob/grep tools operate there. Locally, the default provider can be Docker; on Vercel it is Vercel Sandbox. A durable session has a stable logical sandbox ID. Template bootstrap is template-scoped, while session hooks are session-scoped. Provider VMs may idle, and important output must therefore be persisted externally rather than trusted solely to a sandbox filesystem.

Declared subagents are isolated child sessions and normally receive separate sandboxes. Eve's root built-in `agent` tool can create model-controlled copies that share the parent's sandbox and tools but have fresh history/state. That machinery is intentionally unused here: the root `agent` tool, Workflow tool, subagents, and shell/file sandbox tools are disabled, and the controller never calls `ctx.getSandbox`. The nine pipeline stages are serial root Eve sessions, not subagents. A live ingestion run should therefore create no per-stage Docker or Vercel Sandbox instances.

Docker Desktop showing no running containers is expected. The several `eve-sandbox-template` images observed locally are cached template tags/build generations, mostly pointing at the same layer set; an image is not a running container and several tags are not evidence of eight active agents. No images were deleted during this work.

### Dynamic capabilities and trust boundaries

Eve dynamic capability definitions can vary ordinary tools by session, turn, or step, but each returned dynamic tool must be a real `defineTool` definition with its execution implementation. Eve 0.38.3's provider-managed `webSearch()` is not such a normal tool and fails if wrapped/returned dynamically. This project therefore leaves `web_search` statically available, forbids it by stage instructions where inappropriate, and enforces its stage and count budgets in Postgres. The ordinary framework `web_fetch` definition is disabled globally and dynamically restored only for the three online research stages.

Authored tool code runs in the application runtime and can access deployment secrets. A sandbox is separate, untrusted compute. Here, transcript access, Supabase Storage writes, Postgres transactions, and search-ledger enforcement all occur in authored application-runtime code; no database credential or authoritative packet output is delegated to a sandbox.

### Exact lifecycle of one production run

The production path is:

```text
Vercel Cron (every five minutes UTC)
  -> Eve schedule handler and waitUntil
  -> PRE_RESEARCH_SCHEDULE_ENABLED gate
  -> acquire project-wide Postgres advisory lock
  -> choose oldest current-schema retry-ready run after cooldown
     OR choose the oldest published untouched qualified video
  -> load and validate transcript metadata and Storage presence
  -> enforce 0 < duration_seconds < 5400
  -> claim/create the durable run for transcript hash + packet schema
  -> split transcript into 12,000-character contiguous sections
  -> iteratively summarize section N using the prior cumulative result
  -> persist/validate section checkpoint and compact final context
  -> execute nine isolated serial Eve stages
  -> validate and register each immutable artifact and SHA-256
  -> build the deterministic twelve-operation ingestion intent
  -> run the shared deterministic review policy
  -> if safe, transactionally apply all operations under an apply lock
  -> persist execution receipt and finished marker
  -> release the scheduler advisory lock
```

The nine stage groups create the twelve numbered packet objects: transcript/taxonomy creates `00`, `10`, and `20`; web context `30`; organization research `35`; source verification `40`; curriculum signals `50`; initial summary `60`; technology summary `70`; organization profile `80`; deterministic intent `90`; and successful execution creates the receipt/finished artifacts required by the exact twelve-object prefix.

One Cron invocation is intentionally allowed to end at any durable boundary. The controller has one absolute 240-second invocation deadline and starts no new stage after it. An Eve callback may finish a model step after the controller has stopped waiting; the next eligible tick discovers the registered artifact and continues at the first missing boundary. The Vercel function limit is 300 seconds, leaving roughly one minute for logging, cleanup, and advisory unlock. A concurrent tick cannot start another pipeline while the lock is held and returns `overlap_skipped`.

Search budgets are enforced as 0 for transcript/taxonomy, 3 for web context, 3 for organization research, 2 for source verification, and 0 for curriculum/synthesis. The recorder derives the real stage from the Eve message rather than trusting a model-provided label and serializes duplicate/count/insert under a per-run/per-stage advisory lock.

The source of truth during and after a live run is Postgres plus Supabase Storage, not `outputs/` and not a Vercel filesystem. Vercel's `/var/task` is read-only; production deliberately skips local artifact writes. Every packet is namespaced by schema version, video ID, and run UUID, and every immutable object is hash-registered before it is trusted downstream.

### Failure and recovery semantics

HTTP 503 responses, terminated provider streams, callback timing, and bounded controller timeouts are treated as transient. The current stage parks with all earlier artifacts intact. The scheduler touches a resumed run's `updated_at` as a fairness marker, gives it the configured ten-minute cooldown, and may use an intervening tick to claim a different qualified video. Execution remains globally serial because the advisory lock covers the selected invocation.

Do not diagnose a run as stuck after one idle tick or one `overlap_skipped` result. Investigate when both its artifact count and `updated_at` fail to advance across several ticks after it repeatedly becomes cooldown-eligible. Genuine identity/hierarchy ambiguity is not a transient failure: it becomes `review_required`, is excluded from automatic recovery and new claims, and remains unapplied until a human resolves it through the guarded review process. Task-mode schedules cannot pause for a human interaction, which is why review is persisted as database state rather than attempted inside the Cron turn.

### Vercel-specific deployment facts

Eve's Vercel build generates health, session, stream, callback, workflow, and schedule routes plus Cron configuration. AI Gateway authentication uses the Vercel project's OIDC identity; same-project Eve callbacks use the deployment identity as well. Source deployment is the proven path in this Windows workspace. A prebuilt upload omitted generated callback junctions and was not promoted.

The currently deployed code is isolated from local working-tree edits. Nothing you edit locally changes the live worker until a new production deployment is promoted. Conversely, a deployment can change the instructions and tools used by an already-durable Eve session on its next turn, so deployment sequencing is part of data integrity, not merely release hygiene.

## Deployment and scheduling design

### Production environment

The Vercel project has these production variables (values remain secret and are not copied here):

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_URL`
- `PRE_RESEARCH_SCHEDULE_ENABLED` (non-sensitive control flag)
- `PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES` is optional; the deployed code defaults to `10` and validates `5`–`60`
- `PRE_RESEARCH_SCHEDULE_INVOCATION_BUDGET_MS` is optional; the deployed code defaults to `240000` and validates `60000`–`270000`

Vercel supplies deployment OIDC credentials to AI Gateway and same-project Eve calls. Local remote-agent calls use `@vercel/oidc` so an expired `.env.local` token is refreshed through the authenticated Vercel CLI instead of producing a misleading production-auth failure.

### Schedule behavior

At each five-minute UTC boundary, Vercel invokes Eve schedule `pre-research-next`:

```text
cron tick
  -> PRE_RESEARCH_SCHEDULE_ENABLED check
  -> pg_try_advisory_lock("pre-research-v2-scheduled-dispatch")
  -> skip if another tick still holds the lock
  -> find least-recently-dispatched unfinished run whose retry cooldown elapsed
  -> touch its durable fairness timestamp and resume it
  -> otherwise atomically claim the next eligible video
  -> run one serial pipeline and apply it
  -> unlock
```

The cooldown is scheduler fairness, not concurrent execution: the advisory lock remains held for the selected invocation, and only one video executes at a time. A parked run remains recoverable and rotates back in after ten minutes by default. Override the cooldown with `PRE_RESEARCH_SCHEDULE_RETRY_COOLDOWN_MINUTES` only as a whole number from 5 through 60.

The database claim and immutable artifact registry provide another idempotency layer. Review-required videos are not automatically approved.
They are treated as occupied but non-recoverable, so they remain available to the review tooling without blocking or being reclaimed by the scheduled queue.

### Current external dependency state

The deployment and scheduler are operational. The promotional Blackbox route for `zai/glm-5.2` intermittently returns HTTP 503 or terminates streams after the AI SDK's three internal attempts. AI Gateway metadata shows paid fallback providers being skipped by `billing_gate`, so the project is correctly staying on the free promotional route rather than silently incurring spend. This is not queue corruption or a scheduler-lock failure: section checkpoints and registered artifacts remain intact, the same bounded stage session is reused, and five-minute ticks continue acquiring the advisory lock. The retry cooldown now rotates among durable runs so one provider-stuck stage cannot block new claims. Leave the schedule enabled and let recovery continue. If paid fallback is later desired, treat that as a deliberate billing/product decision rather than a code fix.

To pause without a code deploy:

```powershell
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects
```

Set the value to `false`, then redeploy because Vercel environment changes apply to new deployments. To resume, set `true` and redeploy. To change cadence, edit the `cron` in `agent/schedules/pre-research-next.ts` and deploy.

### Mandatory procedure before changing architecture

The schedule is intentionally still enabled at this handoff so the proven deployment can continue draining the queue. Before deploying changes that alter stage topology, prompts, tools, schemas, packet meanings, session recovery, or database writes:

1. Update production `PRE_RESEARCH_SCHEDULE_ENABLED` to `false`.
2. Redeploy the otherwise-current source. An environment-variable update alone does not change the already-running deployment.
3. Confirm a subsequent Cron log reports `disabled`.
4. Allow an invocation that acquired the advisory lock before the disabling deployment to finish. Its controller budget is 240 seconds; use database state and logs to confirm the lock-owning work settled.
5. Only then deploy and test the architecture change. Do not run a local worker while the old production scheduler can still dispatch.
6. If packet semantics changed, bump the packet schema/prompt bundle/version and explicitly choose whether prior runs are recoverable, migrated, or superseded. Do not make an old immutable packet appear compatible by silently resuming it under a new contract.
7. Run typecheck, all tests, Eve build, Vercel build/deploy, one controlled end-to-end video, canonical database/Storage/hash verification, and review-gate inspection.
8. Restore `PRE_RESEARCH_SCHEDULE_ENABLED=true`, redeploy, verify a real Cron outcome, and re-audit the untouched/recoverable counts.

Compatible bug fixes can reuse durable sessions, but remember that an existing session's next turn uses the newly deployed instructions and tools. For incompatible changes, prefer clean session boundaries and explicit schema supersession.

Observe schedule discovery and history in Vercel **Settings → Cron Jobs** and **Observability → Cron Jobs**. Per-run logs are in **Observability → Logs**, filtered by `[pre-research-schedule]`.

### Deployment commands

From this repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects
npx --yes vercel@latest inspect https://research-starter-pre-research-agent.vercel.app --scope overtons-projects
```

The directory is already linked by `.vercel/project.json`; do not create a second project. The user's default CLI team can be `vantage-4d3db9ef`, so always pass `--scope overtons-projects` for inspection and deployment.

Use the normal source deployment command shown above. A `vercel deploy --prebuilt` attempt on 2026-08-21 failed before promotion because the prebuilt uploader omitted generated Eve callback function paths (`ENOENT ... eve/v1/callback/[token].func`). The subsequent normal source build succeeded and became production.

On this Windows workstation, `npx eve deploy` currently completes its dependency check and then fails because its child process expects a globally discoverable `vercel` executable. Use the explicit `npx --yes vercel@latest deploy ...` command above; it is the equivalent source deployment and produced the current Ready production release.

## Local operating commands

Audit the untouched and recoverable queues:

```powershell
node scripts/list-eligible-videos.mjs --limit 1000 --summary
```

Resume or run exactly one video against production Eve:

```powershell
$env:EVE_URL='https://research-starter-pre-research-agent.vercel.app'
npm run pipeline:next -- --run-id <run_uuid>
```

On this workstation only, the Arris router/ISP DNS path returned an expired router certificate for `ai-gateway.vercel.sh`. The process-local escape hatch preserves SNI and TLS hostname validation while routing only that hostname to a previously verified Vercel edge:

```powershell
$env:PRE_RESEARCH_AI_GATEWAY_IPS='64.239.109.193'
```

Do not disable TLS verification and do not change global Windows DNS for this project. Edge IPs can change; before reusing an IP, resolve through trusted DNS/DoH and verify its TLS certificate for `ai-gateway.vercel.sh`. This override is not needed in Vercel.

Run a bounded local drain only when deliberately desired:

```powershell
$env:EVE_URL='https://research-starter-pre-research-agent.vercel.app'
npm run pipeline:all -- --max-videos 2 --max-transient-retries 5
```

Never run this local drain while the production schedule is enabled. Pause through `PRE_RESEARCH_SCHEDULE_ENABLED=false`, redeploy, confirm the Cron reports `disabled`, and only then start a local worker. Restore `true` and redeploy after the local worker has exited. The advisory lock prevents duplicate scheduled invocations, but this operator rule keeps ownership of the queue unambiguous.

Verify one run end to end:

```powershell
npm run query:pre-research -- --run-id <run_uuid>
```

Inspect an interrupted run:

```powershell
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs <run_uuid>
```

Inspect the durable Eve event boundary without resetting or cancelling it:

```powershell
node scripts/inspect-eve-session.mjs <eve_session_id> https://research-starter-pre-research-agent.vercel.app
```

Omit all additional arguments for read-only mode. Supplying `--reset` or a turn ID is mutating and must be reserved for a confirmed stale session after the normal bounded Cron recovery path has been exhausted.

## Operational history worth preserving

- One abandoned, unregistered orphan intent object for `Tt2kX2sgQio` was removed because immutable storage correctly refused to overwrite it. It was at `pre-research/v2/Tt2kX2sgQio/aaf33572-7b17-46b9-aa69-f0b8fc24df54/90-ingestion-intent.json`, SHA prefix `4b6687…`. It was regenerated deterministically and registered. No other material objects were deleted.
- `TRjq7t2Ms5I` had an old v1 run. The current v2 run completed; the old run remains recorded as superseded.
- `KhYifX22yhE` exposed a false review block: “DeepChem” was explicitly a technology ambiguity, not an organization identity conflict. The classifier now distinguishes that from unresolved ownership, parent-company, rename, merger, spinout, or organizational identity conflicts.
- Empty GLM transcript summaries are now retryable (`TRANSCRIPT_SUMMARY_EMPTY`).
- Production reproduced Eve 0.38.x's `web_search.ts returned kind without defineTool()` warning. `webSearch()` is a provider-managed special definition rather than a normal executable `defineTool`, so wrapping it is also invalid. `agent/tools/web_search.ts` is now static, the stage prompts own the 0/3/3/2/0 budgets, and the replacement deployment advanced a real organization-research stage without the resolver warning.
- A provider recovery briefly exposed a separate capability gap: transcript/taxonomy could see and call Eve's built-in `web_fetch`, producing a needless 429. The framework definition is now disabled and a dynamic resolver restores it only for the three online research stages. The production transcript-stage Gateway request was inspected after deployment and contained `web_search` but no `web_fetch`; its only error was the independent Blackbox 503.
- The `Yk87oUPVaxU` audit exposed inflated web-search accounting: live search ledger entries and artifact-declared searches were both inserted by final intent application. Future packets enforce `.max(3)` on web-context and organization search arrays, `record_web_search_event` enforces 3/3/2 per-run stage caps and ignores duplicate queries, and intent application inserts only a logical query not already present for that run/stage. The already-applied proof run retains 13 historical rows (including repeated logical queries); its research packet, source set, intent operations, and storage hashes all passed. No direct destructive database cleanup was performed.
- The `CgsWxRUY5Eo` audit found a fourth distinct organization query could still enter through final intent application even though the live recorder and artifact schema were capped. The transactional apply handler now also checks the existing per-run/stage count before inserting, so all three entry paths enforce 3/3/2. That already-applied run retains 9 historical rows (3 web-context, 4 organization, 2 source-verification); no destructive cleanup was performed.
- The first real scheduled run exposed two Vercel-only local-filesystem failures: a false `DISK_LOW` check and `ENOENT` under `/var/task/outputs`. Both are fixed as described above and covered by artifact-storage regression tests.
- A pre-fix production Cron invocation started Snorkel AI web-context late in its lifetime and Vercel killed it at 300 seconds; the concurrent 00:20 tick correctly reported `overlap_skipped`, and the durable Eve callback still registered the fourth artifact. Deployment `dpl_4uFCZ64hTmEP6TEg1TSf5DAqULrX` adds one 240-second absolute deadline shared across every controller stage, caps stream waits to the remaining budget, and avoids creating a new stage after expiry. Recovery always consults registered artifacts and resumes at the first missing stage.
- An accumulated attempt-3 Eve history caused the 03:30 UTC Cron function to run out of memory while the controller replayed the complete durable stream. Recovery now stores its tiny stage identity/delivery counter in Postgres and uses bounded, abortable tail reads only. The intermediate attempt 4 safely failed while exposing Eve's rule that a negative `startIndex` requires `follow:true`; the final reader follows from the relative tail and aborts after the already-durable tail goes idle. No immutable artifacts were lost, and the next production attempt reused the cached transcript reducer output.
- During curriculum recovery for `1OMHGsUZiqA`, AI Gateway also returned `gateway_stream_terminated` (`Upstream stream ended before terminal chunk`) in addition to Blackbox HTTP 503. Eve parked both failures and each Cron returned HTTP 200 with the run/artifacts intact. Treat this code as another transient provider boundary; do not fail or rebuild the packet solely because a streamed generation ended before its terminal chunk.
- A live `KwhgfwOSToQ` production run also proved recovery across two external failure classes. Palantir documentation repeatedly returned explicit redirect responses or fetch timeouts during source verification; the stage eventually registered its artifact on a later bounded attempt. Blackbox's free GLM 5.2 route then returned `503 Service temporarily unavailable` after the AI SDK's three internal attempts during curriculum and initial-summary turns. Eve parked those turns, the controller preserved the immutable artifacts, and subsequent Cron ticks resumed the missing stage. Treat these as provider/transient events unless the artifact count and run timestamp both stop advancing across several scheduled ticks.
- `CgsWxRUY5Eo` exposed syntactically valid but fabricated placeholder evidence UUIDs during organization research. The save tool now removes duplicate or unknown references and retains only IDs present in the registered transcript anchors before cross-file validation. This preserves the evidence invariant without spending another model turn repairing optional references.
- The same run exposed an ISO precision false mismatch: `2026-07-28T00:59:04Z` and `2026-07-28T00:59:04.000Z` are the same publication instant. Cross-file validation now compares publication timestamps as instants, while future initial-summary identity fields are stamped from the trusted run manifest rather than accepted from model output.
- The completed `KwhgfwOSToQ` run exposed a final search-ledger edge case: ten historical rows were recorded because the model could label recorder calls as another stage and count-then-insert was race-prone. The recorder now derives the stage itself and both live and apply paths use per-run/per-stage advisory locks plus atomic cap checks. That historical run was not destructively rewritten.
- Kepler and Decagon exposed a PostgreSQL type-inference bug in both search-ledger insert paths: `$1` was inferred as text before assignment to the UUID `run_id` column. Both the transactional intent handler and live Eve recorder now project `$1::uuid`, with a regression test covering both paths.
- The first post-fix Ramp apply exposed model-authored placeholder organization UUID reuse across videos. The executor now remaps colliding candidate/source UUIDs into run-scoped stable UUIDs inside the transaction and carries the candidate mapping into source inserts. New organization profiles are stamped with run-scoped stable candidate/source UUIDs before their immutable artifact is committed.
- The clean Sierra replacement exposed a review-gate mismatch: synthesis used deterministic confidence/domain/source/hierarchy checks, but the executor still refused any model-authored `organization_profile.review_required=true`. Sierra's profile used that advisory flag only for a publication-date discrepancy and an evidence-linkage note; its confidence was `0.75`, candidate/source invariants passed, and it had no ownership or hierarchy conflict. The executor now examines `review_reasons` plus `unresolved_conflicts` for actual hierarchy language and ignores the raw advisory boolean. Genuine parent/subsidiary/ownership ambiguity remains blocked. Two regression cases cover both advisory and hierarchy-only review reasons.
- SonderMind exposed duplicate `source_rank` values inside one organization's otherwise valid model-authored source list. The ingestion schema correctly rejected the intent before immutable intent commit or any database apply. `normalizeOrganizationSourceRanks` now preserves packet order while assigning contiguous ranks independently per candidate, and intent construction uses the normalized copy without mutating the registered organization-profile artifact. The production repair is deployment `dpl_74waHsQMbVRdoh9LK4mMiP7V4orV` and has a focused regression test.
- Persona Engineering exposed a different organization-source collision: the same root URL was emitted once as `official_product` and once as `official_homepage`. Stable stamping correctly assigned both the same source UUID, but retaining both rows would violate the Postgres uniqueness contract. `mergeDuplicateOrganizationSources` now merges by candidate plus normalized URL before future profile commits and again when constructing an intent from an already immutable profile. For a duplicate root page it retains the homepage role, unions product/platform support claims, and preserves required-core status. A verified authoritative homepage can satisfy the technical half only when those persisted claims explicitly name a product, platform, system, or implementation; a generic company homepage still fails. Cross-file validation accepts the URL-equivalent merged row. Deployment `dpl_3A29iALqn31pPJqv3xyJtqjJVEjv` applied the already-immutable Persona packet with five unique organization sources and all twelve operations.
- `Build for the Memo` exposed a final controller-budget boundary. Its transcript reducer consumed almost the full four-minute scheduled budget, then the controller created the transcript/taxonomy Eve session because the only deadline check occurred before preprocessing. No artifact or database state was lost—the isolated session completed durably—but it started with effectively no remaining controller wait budget. Transcript reducer calls now receive an abort signal tied to the shared invocation deadline, retry backoff cannot cross that deadline, section checkpoints remain resumable, and the controller rechecks the clock after context construction before creating a new Eve stage. Deployment `dpl_AU4XQmU4ZUFRxpy175MGrcVtgDRq` contains this fix and its regression test.
- The local `inspect-eve-session.mjs` and guarded recovery scripts still used a static `VERCEL_OIDC_TOKEN`, so a read-only production inspection failed with `eve_production_auth_not_configured` after the short-lived token expired. `scripts/eve-client.mjs` now centralizes the same `getVercelOidcToken` callback used by the controller. A retry successfully inspected Event-Sourced Systems without mutating it: the organization-profile turn loaded its research packet, attempted nullable-field self-corrections, then parked at `session.waiting` without saving artifact 80. This is not a manual-reset condition; the next retry-ready Cron will deliver the controller's single bounded checkpoint nudge and record the delivery count.
- The same Event-Sourced profile exposed GLM serializing top-level nullable Eve tool arguments as the string `"null"`. The model-facing organization-profile and technology-summary input schemas now accept only that exact sentinel and transform it to real JSON `null` before the unchanged strict packet schema runs. Real null remains valid and unrelated string sentinels remain rejected. Deployment `dpl_GwGG5BpWU7jFnTSoEKXjurUtq2CC` includes this defense. The existing Event session succeeded after its bounded nudge and registered artifact 80; future sessions avoid spending that recovery turn.
- Finance Agent then exposed the broader provider form: GLM serialized a complete top-level organization object as a JSON string while leaving array parameters structured. `acceptModelJsonObjectString` now decodes only at the model-facing tool boundary and requires the decoded value to pass the original strict field schema; malformed JSON and schema-invalid decoded objects remain rejected, and immutable packet schemas are unchanged. Its already-registered pre-fix profile preserved Auditoria.AI in `other_organizations` with the correct unique `is_primary_featured=true` and `featured_rank=1`, so the intent assembler now derives an effective profile by promoting only that unambiguous legacy shape. Only provider-authored framework-limitation annotations are removed from the derived review view after that unique promotion; genuine no-organization, ambiguity, and unrelated review evidence remain unchanged and blocked. The Error Resolver replay is `.claude/error-solutions/glm-stringified-object-tool-input.yaml`. All 87 tests pass. Production deployment `dpl_6y1p6jCqaSFB8SC6F47Jo7eYGkif` contains the complete repair. A Windows `--prebuilt` upload reproduced the already-documented Eve junction omission and never became production; normal source deployments succeeded and became Ready.
- A local read-only queue audit at approximately `2026-08-23T03:44Z` received two Postgres `ECONNRESET` errors before its first schema-existence query. Production Vercel logs showed the scheduler and database work continuing normally, and the same local command succeeded after a short fresh-connection interval. This was a transient local transport reset, not malformed SQL or a pipeline defect; no code or data change was made.
- The two Arize runs exposed the remaining three-way review-policy mismatch. Synthesis labelled them `intent_ready`; the executor interpreted ordinary words such as “ownership” and “acquisition” in advisory review notes as unresolved hierarchy and refused them; the controller returned `review_required` without changing the database status. `contracts/review-policy.ts` now owns all automatic review rules. Verified post-video ownership changes are advisory, explicit ambiguity still blocks, and the permitted `complete_synthesis_phase` RPC can defensively reclassify `intent_ready -> review_required`. The first post-deploy Cron tick applied `q2JrUKBMf0w`, proving the loop is closed.
- The second Arize intent then exposed an orphan organization-source UUID: a Dynatrace acquisition press release pointed to a fabricated candidate ID that was absent from the candidate operation. Postgres rolled the entire transaction back, leaving zero partial analysis writes. Future profiles omit these unusable rows before commit; the executor defensively ignores them for already immutable packets, while source-minimum review checks consider only sources with known parents.
- `Byv311hdoHE` / `eef38816-5ac3-4d04-80ca-a7292d47e8cd` reached review at synthesis confidence `0.68`. Manual inspection found that non-primary Palantir incorrectly carried `primary_featured_organization`. The candidate invariant now rejects that role on non-primary organizations. Its validated intent had zero apply events, so `scripts/supersede-review-run.mjs` safely rejected the intent and superseded the run while preserving every immutable object. The scheduler reclaimed the video as `b6a137ef-a6ae-4bb9-adba-efbe621481c5`.

## Remaining work for the next agent

1. Continue draining qualified videos. The production schedule is enabled, recovery-first, fair across parked runs, and is the sole worker. Completion of the entire qualified backlog remains the overarching goal. Review the live backlog audit rather than assuming this snapshot's count, and do not start a local batch while `PRE_RESEARCH_SCHEDULE_ENABLED=true`.
2. Follow the two current recoverable runs. At the final `2026-08-23T17:47Z` audit, Wisedocs `7vn4WpqNpck` / `36cb0c3a-90f4-445c-bd07-c41e4fca8a10` had five durable artifacts and GitHub multiplayer `iQ5xldZ9StU` / `e8d13da9-98f1-4858-aa99-54dafaa4b9e3` had six. Both had null database error fields. CCA field-guide completed and was canonically verified; it must not be treated as recoverable. Inspect a run as potentially stuck only if both its artifact count and `updated_at` stop changing across several ticks after it is cooldown-eligible.
3. Inspect `review_required` runs with `scripts/inspect-review-required.mjs`; approve only after resolving genuine organization identity/hierarchy ambiguity. The known `ZyIoTOAbRfs` packet remains a real manual-review item.
4. Add scheduler observability/alerting for repeated `failed`, `disabled`, or excessive `overlap_skipped` outcomes and for a recoverable run whose `updated_at` stops advancing. A single overlap during a 300-second invocation is expected.
5. Consider replacing the static local AI Gateway IP escape hatch with a small DoH resolver that validates and caches answers. Keep it hostname-scoped and keep TLS verification enabled.
6. Revisit static web-search exposure when Eve officially supports provider-managed search inside dynamic capabilities. Until then, do not wrap `webSearch()` in `defineTool`, preserve the dynamic `web_fetch` allowlist, and do not re-enable subagents, model-authored workflow fan-out, or sandbox tools for this ingestion pipeline.
7. Feed the structured curriculum signals, source-verification records, and organization profiles into the future deep-research/curriculum Eve agent. The pre-research packets deliberately preserve video-time claims separately from current web-verified state; downstream work should keep that temporal distinction.

## Working-tree care

The repository may contain uncommitted implementation changes from this session. Review `git status --short` and commit the complete logical set together. Preserve `scripts/readable-summaries.mjs`; it was a pre-existing untracked user file during this work and must not be discarded. Do not use destructive resets.

## Final verification snapshot

Recorded through `2026-08-23T17:47Z`:

- Production deployment ID: `dpl_6y1p6jCqaSFB8SC6F47Jo7eYGkif`
- Production deployment URL: <https://research-starter-pre-research-agent-8iba6ehky-overtons-projects.vercel.app>
- Production alias: <https://research-starter-pre-research-agent.vercel.app>
- Schedule: exactly one production Cron Job, `*/5 * * * *`, with `PRE_RESEARCH_SCHEDULE_ENABLED=true`
- Local gates: TypeScript passed; 87 tests passed across 32 suites; 0 failed; Eve build passed; Vercel production build passed; `git diff --check` previously reported only expected CRLF warnings
- Production build: passed; one sandbox template reused and zero templates built
- Kepler `1OMHGsUZiqA` / `1993d270-c312-42c6-97db-e2abab52a4ce`: `applied`, `finished=true`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 web-context + 3 organization + 0 source-verification, confidence `0.78`
- Decagon `7wu2hsRfvV0` / `d6a22590-669b-492c-be46-4b7e4be0b4c1`: `applied`, `finished=true`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 + 3 + 0, confidence `0.82`
- Ramp `ITMXwI6QL6A` / `da3649e9-bbab-44c2-9675-83a769cfeec3`: `applied`, `finished=true` at `2026-08-22T19:40:15.540Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 web-context + 3 organization + 0 source-verification, confidence `0.82`, 7 organization sources, and 9 evidence anchors. This is the production proof for both UUID search-ledger casts and organization UUID collision remapping.
- Cognition `RVxym6mmIns` / `2690fadd-8750-4f06-b9ae-d668c26ace38`: `applied`, `finished=true` at `2026-08-22T20:33:36.659Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 web-context + 3 organization + 2 source-verification, 8 organization sources, and 13 evidence anchors.
- Clean Sierra replacement `Byv311hdoHE` / `b6a137ef-a6ae-4bb9-adba-efbe621481c5`: `applied`, `finished=true` at `2026-08-22T20:45:20.093Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 + 3 + 2, 9 organization sources, 13 evidence anchors, and confidence `0.75`. Palantir is correctly non-primary with only `mentioned_only`. This production-proves the strengthened hierarchy invariant, run-scoped organization UUID stamping, and deterministic review-gate alignment.
- Varick Agents `l0FLhNqBOic` / `10beaf07-c4c3-4184-8256-20043878d723`: `applied`, `finished=true` at `2026-08-22T20:55:33.746Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 + 3 + 2, 7 organization sources, and 9 evidence anchors.
- Task/model separation `GgLQ02aO-hs` / `8f5d9af6-26ae-423e-9500-f1a8b53e2817`: `applied`, `finished=true` at `2026-08-22T21:09:02.591Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 + 3 + 2, 7 organization sources, and 8 evidence anchors.
- Vending-Bench `cO8qC6HBuBg` / `2ad35bcc-9722-4add-8001-b0450453fe25`: `applied`, `finished=true` at `2026-08-22T21:40:17.627Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 + 3 + 2, 9 organization sources, and 12 evidence anchors.
- Cybersecurity models `O-CBZ3JtRvo` / `e7cf3d8d-b0f5-470a-acba-e6e47140cdf7`: `applied`, `finished=true` at `2026-08-22T22:00:19.846Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, search rows 3 web-context + 3 organization + 2 source-verification, 8 organization sources, and 9 evidence anchors. Arithmetic is the primary featured organization; the main technology families are Masov Benchmark, ARC-AGI-3, Bach Orchestrator, and the Keycloak microservice security chain.
- Long workshop `il1c1a2FufU` / `826bb7c2-e534-445e-8c2b-10576a29a8c8`: qualified at 4,502 seconds, transcript SHA matched, six 12,000-character chunks reduced and checkpointed (`6/6`), compact cache present, and `raw_transcript_returned=false`. It is `applied`, `finished=true` at `2026-08-22T22:16:53.837Z`, with the exact 12-object prefix, all 12 objects retrieved and hash-verified, all 12 operations applied, search rows 3 + 2 + 2, 6 organization sources, and 13 evidence anchors. OpenAI is primary, and the four leading technology families are Codex Agent Platform, AGENTS.md, the Personal Monorepo Vault Pattern, and Multi-Agent Thread Orchestration. This is the strongest production proof of the large-transcript path end to end.
- Rollout video `jRCpXUjz4CI` / `e55c962e-39c7-432d-9add-338590e556c8`: `applied`, `finished=true` at `2026-08-22T22:39:31.917Z`, exact 12-object prefix, all 12 objects retrieved and hash-verified, transcript SHA matched, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 8 evidence anchors. Laude Institute is primary; the leading technologies are Harbor, Terminal-Bench, Agentic Map-Reduce, and trajectory-based SFT/RL training pipelines.
- Agent-as-judge eval video `q2JrUKBMf0w` / `93ab05ca-5053-488f-928d-443bf26625e5`: qualified at 366 seconds, transcript SHA `310b8ebea304f7e747e9087ebbcec4d3cec1778e3bf089b7a2f755000fe69fe0`, and reducer checkpoint `1/1`. The first post-review-policy deployment tick applied it at `2026-08-22T23:25:20.977Z`. Canonical verification shows `finished=true`, exact 12-object prefix, all objects retrieved and hash-verified, matching transcript SHA, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 6 evidence anchors.
- Self-improving-agent video `9HbzAWnKbo4` / `c5020dc6-6653-4a9b-aa18-2d317b95aaa7`: qualified at 1,236 seconds, transcript SHA `816bca2cdbeae2a335721ab5963266f236a60fa561bb529305cb733694c87984`, and reducer checkpoint `2/2`. Its first apply attempt safely rolled back with zero intent events because one source referenced an absent candidate. After the orphan-source defense deployed, the 23:45 Cron applied it at `2026-08-22T23:45:40.111Z`. Canonical verification shows `finished=true`, exact 12-object prefix, all objects retrieved and hash-verified, matching transcript SHA, all 12 operations applied, exact 3 + 3 + 2 searches, 6 persisted organization sources, and 8 evidence anchors.
- YouTube Ads eval video `xyL2Ltkh-SA` / `c16d8c21-12aa-4efb-abf4-b1b6f36f7fe9`: `applied`, `finished=true` at `2026-08-22T23:23:46.554Z`; exact 12 objects, all hashes and transcript SHA verified, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 6 evidence anchors.
- Uber multimodal-evals video `31GUkCBD-Uc` / `5d60c4bf-b228-4a88-a2f9-2662276e192c`: `applied`, `finished=true` at `2026-08-23T00:07:16.898Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 14 evidence anchors. Uber Technologies is primary and Uber Eats is the product organization; the leading curriculum technologies are the multimodal agent pipeline, closed-loop evaluation system, config-driven auto-tuning, and drift/human-label alignment.
- Character.ai video-evals video `b_PmGocP4rc` / `fbc0bd3c-33b3-4333-98b0-68022ef87b70`: `applied`, `finished=true` at `2026-08-23T00:15:11.342Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `c99ef100cef562528501518de50f0a2ee150f29736c0ef7624e634997811e043`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 organization sources, and 14 evidence anchors. Character.ai is primary; the leading technologies are JudgeJudy, pairwise-preference VLM judging, frame-level video metrics, and audio-visual synchronization evaluation. This was the final in-flight task completed before handoff.
- Snorkel AI agent-simulations video `Ib5t2RLtxvM` / `4e5c6db3-7285-4f73-bcaf-3a474830ffbc`: `applied`, `finished=true` at `2026-08-23T01:00:58.710Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `f7421f6915cc6a5e517ce4492e6630a4b2a59edef978001ba7c24410cdba8e33`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 8 evidence anchors. Snorkel AI is primary; Laude Institute and Stanford University are secondary. The leading technologies are Harbor, private benchmarks from production traces, the agent-ops lifecycle, and public agent benchmarks. This run also traversed the new bounded scheduler across multiple clean lock handoffs.
- Google edge/robotics video `hacEQHHhu2Q` / `bf0a272a-af20-4df9-b714-6cdf79e1fab3`: `applied`, `finished=true` at `2026-08-23T01:12:11.343Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `04ce819ad6376a8d5bae4a1a4903b130fa6d32e679046b235c24dab22277aef3`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 9 evidence anchors. Google AI Edge is primary and Google DeepMind is secondary; the leading technologies are LiteRT, the Gemma edge family, mixed-bit quantization, and synthetic-data fine-tuning.
- HumanLayer loop-engineering video `xIt_mTQp6mY` / `576f4530-cbc6-4bdf-97a8-c645a81a1917`: `applied`, `finished=true` at `2026-08-23T01:22:15.009Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `eec46db5b0243a77802f612a4e3bd21cbb7d6f2b8250121995888664d345232c`, all 12 operations applied, exact 3 + 3 + 2 searches, 8 organization sources, and 10 evidence anchors. HumanLayer is primary; Effect-TS and ast-grep are secondary. The leading technologies are control-theory agent loops, ast-grep, Effect-TS, and the HumanLayer agent platform.
- Factory forward-deployed-engineering video `wpOA-UXynoM` / `4cf4739c-68b3-4bae-92f5-98ff7f6fca52`: `applied`, `finished=true` at `2026-08-23T02:11:02.459Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `408fdd1cab22409d155cbc904619aacb8c52f189e4ef01f6d0faee93517da06f`, all 12 operations applied, exact 3 + 3 + 2 searches, 8 organization sources, and 10 evidence anchors. Factory is primary; EY and Comarch are customer organizations. The leading technologies are Droid, the Factory Software Factory, Factory Missions, and deterministic agent-readiness validation loops.
- OpenAI agent-harness video `BInpv7lGp1o` / `9a711437-2ca9-4c00-b423-c27c844de9da`: `applied`, `finished=true` at `2026-08-23T02:21:00.204Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `aa2a10f89e18dc3a0b54774fdbe6e044c96efa1d388199caf742052c5d5701ca`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 organization sources, and 13 evidence anchors. OpenAI is primary and OpenClaw Foundation is the implementation owner; the leading technologies are agent-harness architecture, OpenAI Agents SDK, run-receipt auditing, and OpenClaw.
- SonderMind mental-health-coach video `O72p-rBb2bA` / `67435e8b-ac1f-49bc-b483-febf3a814127`: `applied`, `finished=true` at `2026-08-23T02:31:18.735Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `a05babbb107dc4228ca77a548a31abc2a59536c15430f21dca3f6ff67aeffcc0`, all 12 operations applied, exact 3 + 3 + 2 searches, 8 organization sources, and 9 evidence anchors. This is the production proof for source-rank normalization: the prior duplicate-rank intent was rejected before commit, the repaired deployment reused the same stage session, normalized a copy of the source list, and applied without a manual data edit. SonderMind is primary; the leading technologies are LLM-as-judge guardrails, the clinical annotation-to-eval pipeline, open guardrail-calibration datasets, and calibration design.
- Morgan Stanley ALPHALAB video `kiqubc5b5Yo` / `2628769c-d351-4dec-8019-21f7bab72a28`: `applied`, `finished=true` at `2026-08-23T03:12:11.612Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `d6cbb999b3b30b1baa0243c1ebbfc8ef9faf08a23d6266f83ea7d172ca5e2201`, all 12 operations applied, bounded 3 + 2 + 2 searches, 7 organization sources, and 12 evidence anchors. Morgan Stanley Machine Learning Research is primary; Prime Intellect and NVIDIA are secondary. The leading technologies are the ALPHALAB multi-agent harness, adversarial Builder/Critic/Tester eval construction, verifiable RL environments, and self-improving meta-harness optimization.
- SimulationMaxxing video `KMR_RBoCa4M` / `8b0065da-aa1f-4805-a2b4-ce14c10d3bf6`: `applied`, `finished=true` at `2026-08-23T03:30:46.595Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `4199d362c8083ef2b41bc28bb7dd928c217a2981fe3101f6a9920ff2cf6631b3`, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 9 evidence anchors. Nubank is primary; Guardrails AI and Snowglobe are secondary. The leading technologies are Snowglobe Simulation Engine, LLM-as-judge evaluation, the ship-observe-simulate loop, and multi-turn trajectory generation.
- FactSet skill-centric-harness video `7jjudsEhBtM` / `a196bc04-36bd-469c-9970-6df3fe482c38`: `applied`, `finished=true` at `2026-08-23T03:50:32.716Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `589b5b2c5d0f9043568a981f9aefc7d214e2510fcdf3b5c40037d6e8c7af2471`, all 12 operations applied, bounded 3 + 2 + 2 searches, 6 organization sources, and 8 evidence anchors. FactSet is primary and Anthropic is the standards steward. The leading technologies are the Agent Skills specification, skill-centric harness architecture, embedding-based skill shortlisting, and enterprise skill-library governance.
- Persona Engineering video `YnNF55QV0zs` / `dbec0613-e2b0-4cf0-a574-60641f7ecc53`: `applied`, `finished=true` at `2026-08-23T04:40:31.264Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `81c4159d88326ec6a69a0112b7a92223e112fb35db89753dd175d50b83dd481b`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 persisted unique organization sources, and 10 evidence anchors. This production-proves same-URL organization-source merging from an already immutable profile. Insight Sciences is primary and Simulmatics Corporation is historical context; the four leading technologies are silicon sampling, text-completion prompting, fine-tuning for subpopulation alignment, and text-expression mapping via semantic similarity.
- Nubank AI-skills vetting video `iKQ78wyJEXU` / `0a66f53c-5105-4d9a-86cb-d3e246896a17`: `applied`, `finished=true` at `2026-08-23T05:31:07.412Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `2e3ed5833098daf613c84c9ce60105c4413acaf25d9235c60643678a737c58e0`, all 12 operations applied, exact 3 + 3 + 2 searches, 8 organization sources, and 7 evidence anchors. The model naturally produced eight distinct candidate/URL source pairs after the duplicate-source repair. Nubank is primary; NVIDIA, OWASP Foundation, and JFrog are secondary. The leading technologies are the AI Skill Security Scanning Pipeline, SARIF integration, the AI Skill Supply Chain Security Framework, and MCP Server Security.
- Wearable Agent video `s67bE2Ur3bY` / `afb19547-afed-435a-a53f-68175b56cbbb`: `applied`, `finished=true` at `2026-08-23T05:35:25.883Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `2dc9d81c4a5dac2ca5c23054cde11efd7be448049fdaf6e9c9aeb7e666ac0307`, all 12 operations applied, bounded 3 + 2 + 2 searches, 5 organization sources, and 9 evidence anchors. Its profile also naturally produced five distinct candidate/URL source pairs after the repair. Fidelity Investments and Carnegie Mellon University are the featured organizations; the leading technologies are Jataayu's authorization architecture, per-user LoRA permission/injection-detection adapters, learned relevance eviction, and the SuchiLM/Judith agent platform.
- Event-Sourced Systems video `o6U_2vd967Y` / `20de9ea3-4386-4635-8611-7d08304cb885`: `applied`, `finished=true` at `2026-08-23T06:30:57.921Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `b488993dbf564afc59aca187c874fec70f5432f7af9719b9cc3b2c7d8f7e1320`, all 12 operations applied, bounded 3 + 2 + 2 searches, 6 organization sources, and 11 evidence anchors. Flyers Soft Private Limited is primary and Microsoft Corporation is the platform partner. The leading technologies are fan-out/fan-in orchestration, event sourcing as agent memory, saga orchestration, and semantic/materialized views for agent context. This production run also proves bounded same-session recovery from both a nullable tool-input mismatch and a parked synthesis boundary.
- Build-for-the-Memo video `tJFjeMBKbIY` / `9573ef99-38e6-44b9-b211-875f8d66a810`: `applied`, `finished=true` at `2026-08-23T07:06:07.150Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `9926af6791b08750cfdc8f1d8f32dc0329d714f614169ad2315a4be6270e624f`, all 12 operations applied, bounded 3 + 2 + 2 searches, 6 organization sources, and 12 evidence anchors. China Resources (Holdings) is primary; Alphabet, Air Canada, and OpenAI are secondary examples. The leading technologies are provenance-backed RAG, hallucination/confidence calibration, human approval and audit systems, and automated document-quality verification. This run production-proves reducer-deadline recovery and subsequent full serial completion.
- Finance Agent video `z0sh8HyTrDo` / `13ad277f-1e6c-4ce7-a71e-5ac0fc5f1a0d`: `applied`, `finished=true` at `2026-08-23T07:13:44.099Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `1c1bcd4a13bf752f9e0bab1a21edbf19fd05dee8602c28bed498dca338d0e94d`, all 12 operations applied, bounded 3 + 2 + 2 searches, 5 organization sources, and 6 evidence anchors. Auditoria.AI is the unique primary and Anthropic is secondary; the leading technologies are MCP, parallel sub-agent orchestration with Git worktrees, Auditoria SmartFlow Skills, and recursive self-improvement. The guarded review inspector proved candidate and primary-source invariants both pass with confidence `0.85`; the only block was the pre-fix framework-limitation annotation, so `apply:intent --approved` safely executed the already validated intent with no manual artifact or row rewrite.
- Automated-AI-Research video `pWXUkLP9uWM` / `55c86923-b0a3-419c-8212-b59c1dad734a`: `applied`, `finished=true` at `2026-08-23T08:03:18.778Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `10f7a79da293b16f4e4e438ff0743acad5b4cf4beb9e744241e8c8a8f1e53ead`, all 12 operations applied, bounded 3 + 2 + 2 searches, 6 organization sources, and 13 evidence anchors. Recursive Superintelligence is primary; You.com and NVIDIA are secondary. The leading technologies are Recursive's self-improvement system, nanochat, NanoGPT Speedrun, and NVIDIA SOL-ExecBench. It automatically traversed the provider-object compatibility repair through organization profile and apply without review or manual approval.
- Fighting-slop-with-slop video `AMiyLItEtLA` / `8178aeeb-aa33-4f83-aa8c-520a02f1781c`: `applied`, `finished=true` at `2026-08-23T08:07:09.317Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `3caeeafc05b64fa3645a8415aa3a6d284545d400edc445a965eea80efb86de40`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 organization sources, and 15 evidence anchors. Boundary is primary. The leading technologies are BAML, agent-driven code-quality detection, type-safe cross-language/compiler error handling, and agent-first tooling/observability.
- MiniMax agents-at-scale video `AVMr9PMINyo` / `c99b8675-1414-4638-9689-e52ec971637a`: `applied`, `finished=true` at `2026-08-23T08:28:42.561Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `6e458e30da3d2be63374d0238241d39ec21502a54b96f74faeb0a4e6844540e5`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 organization sources, and 13 evidence anchors. MiniMax is primary and Together AI is secondary. The leading technologies are MiniMax Sparse Attention and its custom-kernel stack, ParallelKernelBench, million-token KV-cache management, and multimodal training from scratch. The 08:25 Cron replaced the retired technology-summary session with a clean organization-profile session, then completed intent and apply within the same bounded invocation.
- Prime Intellect reinforcement-learning video `AQv3qRCG6Gw` / `389a656b-1ae3-48f2-a607-7e18c8df62b0`: `applied`, `finished=true` at `2026-08-23T09:01:42.323Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `5cbd690add384ea33f9c6a38e6ffb2c6b0099d27207358906547ec1c5dd81ddd`, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 11 evidence anchors. Prime Intellect is the unique primary. The leading technologies are the Prime Intellect Lab platform, composable RL environments and verifiers, large-scale asynchronous `prime-rl`, and ECHO/PaW native world-model training. Its final Cron reused all ten prior artifacts and executed only the missing intent/apply path.
- G2i benchmarks video `jWq-aZIU0kM` / `d2ca6922-79f5-4896-b6e8-341259a03bc0`: `applied`, `finished=true` at `2026-08-23T09:05:49.471Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `a6ac8a102a09e41f406ee82e7da62bf6cfc35c2a4134c0f270d450d83ac6424b`, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 7 evidence anchors. G2i is primary; Scale AI and Datacurve are secondary. The leading technologies are SWE-bench Pro, DeepSWE, benchmark-evaluation pipeline architecture, and benchmark reward-hacking analysis. Its final Cron likewise reused all ten prior artifacts and executed only the missing intent/apply path.
- Taste Labs AI-slop video `lCBf9slCanI` / `c94afb6a-457c-4202-9a9d-b87f3cbe6c18`: `applied`, `finished=true` at `2026-08-23T09:25:49.192Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `9ea8415fd010a21feb754aebad4a9fc7c49266f3d2b52935351f98a629f54e0e`, all 12 operations applied, bounded 3 + 2 + 2 searches, 5 organization sources, and 10 evidence anchors. Taste Labs is primary and Reducto is secondary. The leading technologies are subjective-domain decomposition and routing, pluralistic preference-vector infrastructure, expert evaluation/QA, and the Taste Labs data platform. Its final Cron reused all ten prior artifacts and executed only the missing intent/apply path.
- Arcee AI base-model video `xbPriQWXtWM` / `5d048c95-e108-4f60-94ed-5c76a857c4b5`: `applied`, `finished=true` at `2026-08-23T09:53:00.954Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `ace506648631cf15941b04f8252b88bd9832580e350d3ef51403c5e0648c5cff`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 8 evidence anchors. Arcee AI is primary; Microsoft AI, Moonshot AI, and Xiaomi MiMo are secondary. The leading technologies are MAI-Thinking-1, Kimi K2, Arcee's Trinity family, and Composer 2.5. Its final selected invocation advanced from organization profile through deterministic intent/apply without replaying earlier stages.
- LatchBio biology-environments video `3ZMUiFaQ3qg` / `7875057c-1625-477b-8008-fa05a9f9c869`: `applied`, `finished=true` at `2026-08-23T10:00:51.283Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `13db39107453e53ecc665e1bb58bd2b4b12abc0ca65d0ae1fe31a4e5ecbfd765`, all 12 operations applied, exact 3 + 3 + 2 searches, 8 organization sources, and 9 evidence anchors. LatchBio is primary; American Wetware, TwentyTwo, and Aclid are secondary organizations. The leading technologies are SpatialBench, SpatialBench-Long and choke-point rubrics, BioSecBench-Refusal, and LatchBio's benchmark flywheel/expansion platform. Its final Cron reused all ten prior artifacts and executed only the missing intent/apply path.
- Emulated autonomous-software-engineering video `zkX03APVj0M` / `8c1d179c-a4ca-4787-89a4-a5b724485e68`: `applied`, `finished=true` at `2026-08-23T10:14:09.355Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `5d8d1031fbf495d79dcec4758c0cf2d78fe93bbffd97509788fc9a784c85f48f`, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 9 evidence anchors. Emulated is primary; Modal and Supabase are secondary. The leading technologies are high-fidelity RL simulation environments, agentic coding benchmarks, distributed-consensus/infrastructure reasoning, and cloud provisioning/sandbox platforms. Its organization-profile turn completed asynchronously inside the selected invocation, after which a clean intent session applied the packet.
- General Reasoning long-horizon video `2bvtay8wGYI` / `7c9f0422-90be-4489-8880-696e4f6dce2b`: `applied`, `finished=true` at `2026-08-23T10:38:36.703Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `f4f802f5558eb7677a6e2126be850ee958a1fda217b53242cea70644a7137859`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 14 evidence anchors. General Reasoning is primary; Meta AI and Papers With Code are secondary. The leading technologies are PPO with verifiable rewards/value models, Galactica, OpenReward, and KellyBench. Its selected synthesis invocation reused all earlier research and initial-summary artifacts and completed technology summary, organization profile, and intent/apply serially.
- Bespoke Labs post-training-data video `ewtOo0scUh0` / `ad52972c-1ca9-4d08-98e1-d18fbe9408dd`: `applied`, `finished=true` at `2026-08-23T11:05:15.406Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `678cbdc56930508dbf641ceee6b4dbd5817d5ef0fbc5bc5b88c8ff0747cf3b34`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 7 evidence anchors. Bespoke Labs is primary; Intuit and Credit Karma are secondary. The leading technologies are the OpenThoughts curation recipe, Bespoke Curator, GEPA prompt optimization, and Dynamic Semantic Tags.
- Applied Compute continual-learning video `k35LeKZEhiE` / `57c5c06d-0101-4333-aede-807a63433b55`: `applied`, `finished=true` at `2026-08-23T11:10:49.036Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `25dc50fa36568d283406b48fbd135883170b500e416d55115fff7db4048de09a`, all 12 operations applied, bounded 3 + 2 + 1 searches, 6 organization sources, and 9 evidence anchors. Applied Compute is primary; NVIDIA and DeepSeek are secondary. The leading technologies are GRPO, Bring-Your-Own-Harness training, self-distillation for post-training, and sandboxed multi-turn RL environments. The 11:10 Cron reused all ten prior artifacts, completed only the missing organization profile, and proceeded directly through intent/apply.
- DatologyAI data-quality video `_PdK6x7PQNM` / `5d471dd0-db8f-4479-84c7-e74a463a95d7`: `applied`, `finished=true` at `2026-08-23T11:23:24.068Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `caf19be9e14b00ef2247174b8ac9a0abf35b5e83a05dc90ae13b5e2c9fda8569`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 15 evidence anchors. DatologyAI is primary; Arcee AI, Thomson Reuters, and Meta AI (FAIR) are secondary. The leading technologies are DatologyAI's Data Refinery, data pruning that modifies the scaling-law exponent, synthetic-data generation by rephrasing, and Arcee AI's Trinity Large. Its 11:20 recovery invocation reused the nine prior artifacts and completed organization profile through intent/apply.
- TypeSafe AI post-RLHF video `cJ0EOzey--o` / `7b09a3d3-e827-42a1-9351-64a476ff887e`: `applied`, `finished=true` at `2026-08-23T11:45:51.400Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `1232c2270e8bb01f2ce7776e478078b27c20421992807d51a127a1f7ee0efa0d`, all 12 operations applied, bounded 3 + 2 + 2 searches, 5 organization sources, and 9 evidence anchors. TypeSafe AI is primary and OpenAI is secondary. The leading technologies are RLHF, RLVR, TypeSafe AI's calibrated-decision-making paradigm, and its reinterpretation of Sutton's Bitter Lesson. The 11:45 Cron reused all ten prior artifacts and executed only intent/apply.
- Theta Software long-horizon-environments video `2aS7aKoXn64` / `74c5e1db-6f3d-4a67-86ae-cc84899a7225`: `applied`, `finished=true` at `2026-08-23T12:10:49.277Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `7cc376ece5cadff6a03a1423d64fc2f5659f910213fec9bd22433491d508c469`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 organization sources, and 10 evidence anchors. Theta Software is primary; METR, Mercor, and OpenAI are secondary. The leading technologies are METR's time-horizon methodology, judge/critic-model verification, APEX-Agents, and GDPval. The 12:10 Cron reused all ten prior artifacts and executed only intent/apply.
- Bugcrowd cybersecurity-evaluation video `ZFxh7sqbUZo` / `77331219-f696-4109-84a1-c4be6e960b3a`: `applied`, `finished=true` at `2026-08-23T12:20:52.538Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `a5220974e597a82c8e670e4ea319ef4e84a3642c89cfc306036bf8f11bacce4b`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 13 evidence anchors. Carnegie Mellon University is primary; Bugcrowd, Anthropic, and DARPA are secondary. The leading technologies are ExploitBench, deterministic grading/audit methodology, the MCP-based security-evaluation harness, and RL environment generation for cybersecurity. The 12:20 Cron reused all ten prior artifacts and executed only intent/apply.
- Surge AI benchmark-quality video `-npY6XjM8CQ` / `53357029-8ea3-4dae-96e4-342483f8cf29`: `applied`, `finished=true` at `2026-08-23T12:50:06.625Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `439fe963524461aef03670f5fe8f08daa337724892f7322c350f041b35fee260`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 8 evidence anchors. Surge AI is primary; Arena AI, OpenAI, and LMSYS Org are secondary. The leading technologies are SWE-bench Verified, Arena/LMArena, Hemingway-bench, and IFEval. Its final selected invocation completed synthesis through apply, after which the same 12:50 schedule boundary safely selected the next retry-ready packet only after the advisory lock was released.
- Temporal asynchronous-MCP video `s4r6nk5WsZw` / `06ec3f95-dfbc-4757-88c8-ae258237a07a`: `applied`, `finished=true` at `2026-08-23T13:25:35.830Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `43807caa27216591818eecd9bc61ecc907c10d208a8fe16869e73ea14e55762b`, all 12 operations applied, exact 3 + 3 + 2 searches, 8 organization sources, and 14 evidence anchors. The Model Context Protocol standards body is primary; Temporal Technologies, Prefect, and Anthropic are secondary. The leading technologies are MCP Tasks V1/V2, MCP's stateless core and extension framework, Temporal durable execution, and FastMCP. The preceding invocation ended safely at `intent_ready` with 11 immutable artifacts; the 13:25 retry applied that already-validated intent without replaying synthesis.
- MCP Apps interactive-UI video `-jY2T2PiJBE` / `0dc8ae0d-0dea-4740-a096-b2eca46e7584`: `applied`, `finished=true` at `2026-08-23T13:37:35.753Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `0bdf3a4caf04b09b4f291cab63a9ab69ed53e60664e97acbf34385cfa3c99d40`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 10 evidence anchors. The Model Context Protocol standards body is primary; MCP-UI, Anthropic, and OpenAI are secondary. The leading technologies are MCP Apps/SEP-1865, MCP-UI, the foundational MCP protocol, and A2UI. Its final selected invocation completed organization profile through intent/apply without replaying earlier synthesis artifacts.
- Turbopuffer long-form infrastructure interview `jQDXzEVHMSE` / `b5b47584-a684-4cd5-bd23-9626d37b8efb`: qualified at 3,390 seconds with a 59,901-character transcript and `applied`, `finished=true` at `2026-08-23T14:00:49.695Z`. Its first four-minute invocation produced only durable iterative-reducer section checkpoints; the next selected invocation reused them, completed the compact cumulative transcript context, and entered transcript/taxonomy without injecting raw transcript history. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `9ba056d56e684e84d95bb9fde88a0010c391dab0720af7e8d0c3d8d57a240add`, all 12 operations applied, bounded 3 + 2 + 2 searches, 8 organization sources, and 21 evidence anchors. Turbopuffer is primary; Shopify, Anysphere/Cursor, and Readwise are secondary. The leading technologies are Turbopuffer's object-storage vector search, napkin math, and Toxiproxy. This is the strongest production proof that a large qualified transcript survives reducer checkpoints, scheduler cooldowns, stage isolation, and full Supabase apply.
- Cloudflare Gadgets personal-codegen video `RmS5s6Wbin4` / `d9f5dfe8-540e-40fd-aa0d-4903028887ca`: `applied`, `finished=true` at `2026-08-23T14:40:59.864Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `626712352133f989f5936bb1888354341ebb083f9d83637aebc86f19bcd19f9d`, all 12 operations applied, bounded 2 + 3 + 2 searches, 6 organization sources, and 11 evidence anchors. Cloudflare OS is primary; Cloudflare and Cloudflare Workers are secondary. The leading technologies are Cloudflare OS/Gadgets, Cap'n Web RPC, workerd, and its sandboxed vibe-code execution architecture. Its final selected invocation reused all ten prior artifacts and executed only intent/apply.
- Model-routing panel `QHBjufYK8TA` / `547b6c46-0f63-473d-a7ec-d4d840b81bda`: qualified at 2,897 seconds with a 50,211-character transcript and `applied`, `finished=true` at `2026-08-23T15:05:35.775Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `b507e7d05a4ffea2c1abd1bf8e5e4d7fa2cbea67e4e1457afd19865755da2ead`, all 12 operations applied, exact 3 + 3 + 2 searches, 5 organization sources, and 14 evidence anchors. Cognition is primary; OpenRouter and NVIDIA are secondary. The leading technologies are multi-model routing, KV-cache economics/management, context compaction, and model-state detection using hallucination probes. The packet reached 11 artifacts in one bounded invocation and the 15:05 Cron applied the already-validated intent without replaying synthesis.
- Edge-compression panel `J4_jCrTxMkk` / `89af43c3-f0f5-4af3-a7ca-dba44d66f106`: qualified at 2,761 seconds with a 44,034-character transcript and `applied`, `finished=true` at `2026-08-23T15:32:11.005Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `b304be4671693742af804507d3be2935a27dc83f3502e53d2e3f1fb885ea07e1`, all 12 operations applied, exact 3 + 3 + 2 searches, 7 organization sources, and 14 evidence anchors. NVIDIA is primary; Unsloth, Hugging Face, and Ollama are secondary. The leading technologies are NVFP4 microscaling, mixed-precision dynamic quantization, PTQ/QAD, and KL-divergence evaluation for compressed models. Multiple Cron invocations reused reducer and packet checkpoints, and the final invocation executed only the missing organization-profile/intent/apply path.
- Cline open-source talk `CoEIs6Xm8m8` / `5e18d312-252f-42ed-b38e-903f276528f5`: qualified at 1,050 seconds with a 16,127-character transcript and `applied`, `finished=true` at `2026-08-23T16:08:59.535Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `a6c35fe1524a382fb5bf36e450e4a593613a85815bd0f58a1a3eb26efe16f965`, all 12 operations applied, bounded 3 + 2 + 2 searches, 8 organization sources, and 10 evidence anchors. Cline is primary; Berri AI, GitHub, and Coinbase are secondary. The leading technologies are Cline's coding agent, LiteLLM, open-weight LLM families, and internal LLM gateways. The first invocation still used the mandatory reducer, and later Cron invocations reused every prior packet boundary through organization profile and apply.
- Daily AI-native-software keynote `LZuWZRze3MU` / `d5daeefb-d1b0-4984-9a24-3040ddd263d9`: qualified at 1,274 seconds with an 18,385-character transcript and `applied`, `finished=true` at `2026-08-23T16:47:04.202Z`. Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `ba5301201c9b77a6309223e831b0f9280159c45b14b2d06d7bc860eeb704a16c`, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 8 evidence anchors. Daily is primary; Pipecat and Oblong Industries are secondary. The leading technologies are Pipecat, Gradient Bang, Daily's real-time media platform, and AI-native software architecture. The final selected invocation reused nine artifacts and completed organization profile through deterministic intent/apply.
- Local Models talk `FWMJQDH3iK0` / `3453d6f1-8613-443a-896d-79bc3733b018`: qualified at 2,601 seconds with a 45,035-character transcript and `applied`, `finished=true` at `2026-08-23T16:56:27.874Z` (`applied_at=2026-08-23T16:56:27.262564Z`). Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `b4e44b59852489c6fcba49f166ce67241ab333fa32b6596b935e8734dbd19435`, all 12 operations applied, exact 3 + 3 + 2 searches, 6 organization sources, and 15 evidence anchors. Prime Intellect is primary; Arcee AI, NVIDIA, and Ramp are secondary. The leading technologies are NVIDIA Nemotron, Arcee Trinity, Prime Intellect infrastructure, and OpenMDW. Its final bounded invocation reused the ten earlier artifacts and completed intent/apply without duplicating prior stages.
- Anthropic CCA field-guide talk `Z-c11pV_uvU` / `d44aa9c2-b137-4778-bf8c-28c0e1038170`: qualified at 1,208 seconds with a 15,577-character transcript and `applied`, `finished=true` at `2026-08-23T17:45:56.154Z` (`applied_at=2026-08-23T17:45:55.535099Z`). Canonical verification shows the exact 12-object prefix, all 12 objects retrieved and hash-verified, matching transcript SHA `58fa2a9b340514dff175a3dc6054db9c460c4c4b19bb9d7e48af5a960ac885f3`, all 12 operations applied, bounded 3 + 2 + 2 searches, 8 organization sources, and 9 evidence anchors. Anthropic is primary; UC Berkeley School of Information, The AI Edge, and Pearson VUE are secondary. The leading technologies are Agentic Loop Architecture, Multi-Agent Orchestration, Claude Code, and the Message Batches API. The run advanced across several independent Cron selections and delayed callbacks, then its final invocation reused ten artifacts and executed only deterministic intent/apply.
- Original Sierra `Byv311hdoHE` / `eef38816-5ac3-4d04-80ca-a7292d47e8cd`: safely superseded, intent rejected with zero apply events, immutable packet preserved. Replacement `b6a137ef-a6ae-4bb9-adba-efbe621481c5` is applied and canonically verified with capped search rows of 3 web-context + 3 organization + 2 source-verification.
- Untouched eligible count: 19 at `2026-08-23T17:21Z`. Next untouched: `vSx5IULvBns` (`Always-on agents run production without the on-call tax — Justin Smith, Resolve AI`, 1,496 seconds). Wisedocs and GitHub multiplayer were claimed durably after the preceding snapshot. The source catalog can grow while this worker drains it, so always rerun the canonical summary.
- Recoverable count: 2. Wisedocs `7vn4WpqNpck` / `36cb0c3a-90f4-445c-bd07-c41e4fca8a10` has five durable artifacts; GitHub multiplayer `iQ5xldZ9StU` / `e8d13da9-98f1-4858-aa99-54dafaa4b9e3` has six. Both have null run/session error fields. CCA, Local Models, and all earlier applied proof runs are finished and no longer recoverable.
- The paired 05:40/05:45 observations are important: 05:40 selected Event-Sourced Systems, retained its prior six artifacts, and advanced only missing stages; 05:45 claimed one new video while Event-Sourced Systems cooled down. This directly production-proves both recovery-first reuse and fair bounded expansion without rapid sandbox/subagent fan-out.
- Current external condition: Blackbox's free GLM 5.2 route remains intermittently affected by HTTP 503 and prematurely terminated streams, and individual web pages can redirect, return 403, or time out. Durable recovery continues to work. The nominal 00:00 Cron delivery arrived with several minutes of Vercel jitter, moved Uber through all four synthesis stages, and applied it at 00:07 without duplicate execution. Database state, not exact wall-clock delivery, remains the authoritative progress signal.
- A separate genuine review packet remains: `ZyIoTOAbRfs` / `0b7dfea6-0ca6-48a5-bc32-3853db185384`, 11 pre-apply artifacts and zero automatic apply.

### Final operator boundary: what is running and how to control it

At `2026-08-23T17:47Z`, there is no local Eve server, local batch runner, Docker container, Codex watcher, or second pipeline worker running. The only continuing executor is the deployed Vercel Cron schedule `pre-research-next`, enabled by `PRE_RESEARCH_SCHEDULE_ENABLED=true` and delivered every five minutes UTC. The 17:45 invocation completed CCA and released its advisory lock. A delayed GitHub source-verification callback registered artifact 6 afterward; durable callbacks landing after a controller return are expected. The next Cron tick will select the oldest cooldown-eligible run under the global advisory lock.

The authoritative queue at this boundary is:

- 19 untouched qualified videos; next untouched is Resolve AI `vSx5IULvBns`, 1,496 seconds.
- Wisedocs `7vn4WpqNpck` / `36cb0c3a-90f4-445c-bd07-c41e4fca8a10`: `analyzing`, 5 artifacts, last scheduler fairness timestamp `2026-08-23T17:35:37.190Z`.
- GitHub multiplayer `iQ5xldZ9StU` / `e8d13da9-98f1-4858-aa99-54dafaa4b9e3`: `analyzing`, 6 artifacts, last durable update `2026-08-23T17:42:44.542Z`.
- Both recoverable runs have null database error fields. No human intervention is required.
- CCA `Z-c11pV_uvU` / `d44aa9c2-b137-4778-bf8c-28c0e1038170` is applied, finished, and canonically verified; it is not running.

To leave the proven worker running, do nothing. Local file edits do not affect the deployed worker until a production deployment occurs.

To stop new dispatches safely:

```powershell
# The CLI prompts for the new value. Enter: false
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects

# Environment changes affect only new deployments, so promote a source deployment.
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects
```

Then wait for the next five-minute Cron boundary and confirm `[pre-research-schedule] outcome` reports `disabled`. A dispatch that acquired the advisory lock before the disabling deployment is not forcibly killed; allow up to the 240-second controller budget plus cleanup for it to settle. Do not cancel Eve sessions or mutate orchestration rows. Their durable artifacts remain resumable.

To continue after it has been stopped:

```powershell
# The CLI prompts for the new value. Enter: true
npx --yes vercel@latest env update PRE_RESEARCH_SCHEDULE_ENABLED production --scope overtons-projects
npx --yes vercel@latest deploy --prod --yes --scope overtons-projects

# Verify deployment and queue state.
npx --yes vercel@latest inspect https://research-starter-pre-research-agent.vercel.app --scope overtons-projects
node scripts/list-eligible-videos.mjs --limit 1000 --summary
```

Confirm a subsequent Cron log shows a normal structured `completed` outcome or an expected `overlap_skipped`. The scheduler automatically resumes the oldest retry-ready current-schema run; no manual `--run-id` call is required. Never start `pipeline:all` locally while the production flag is enabled.

If architecture work is about to be deployed, use the stronger eight-step procedure in “Mandatory procedure before changing architecture,” including disabling/redeploying first, allowing an existing invocation to settle, versioning incompatible packet semantics, and verifying one controlled end-to-end run before re-enabling the drain.

### Session-close continuation commands

From `research_starter_pre_research_agent/`:

```powershell
# Inspect the current recovery-first runs. They may have advanced when resumed.
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs 36cb0c3a-90f4-445c-bd07-c41e4fca8a10
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/inspect-run-session.mjs e8d13da9-98f1-4858-aa99-54dafaa4b9e3

# Canonical end-to-end verification after each reaches a terminal state.
npm run query:pre-research -- --video-id=q2JrUKBMf0w --run-id 93ab05ca-5053-488f-928d-443bf26625e5
npm run query:pre-research -- --video-id=9HbzAWnKbo4 --run-id c5020dc6-6653-4a9b-aa18-2d317b95aaa7
npm run query:pre-research -- --video-id=b_PmGocP4rc --run-id fbc0bd3c-33b3-4333-98b0-68022ef87b70
npm run query:pre-research -- --video-id=Ib5t2RLtxvM --run-id 4e5c6db3-7285-4f73-bcaf-3a474830ffbc
npm run query:pre-research -- --video-id=hacEQHHhu2Q --run-id bf0a272a-af20-4df9-b714-6cdf79e1fab3
npm run query:pre-research -- --video-id=xIt_mTQp6mY --run-id 576f4530-cbc6-4bdf-97a8-c645a81a1917
npm run query:pre-research -- --video-id=wpOA-UXynoM --run-id 4cf4739c-68b3-4bae-92f5-98ff7f6fca52
npm run query:pre-research -- --video-id=BInpv7lGp1o --run-id 9a711437-2ca9-4c00-b423-c27c844de9da
npm run query:pre-research -- --video-id=O72p-rBb2bA --run-id 67435e8b-ac1f-49bc-b483-febf3a814127
npm run query:pre-research -- --video-id=kiqubc5b5Yo --run-id 2628769c-d351-4dec-8019-21f7bab72a28
npm run query:pre-research -- --video-id=KMR_RBoCa4M --run-id 8b0065da-aa1f-4805-a2b4-ce14c10d3bf6
npm run query:pre-research -- --video-id=7jjudsEhBtM --run-id a196bc04-36bd-469c-9970-6df3fe482c38
npm run query:pre-research -- --video-id=YnNF55QV0zs --run-id dbec0613-e2b0-4cf0-a574-60641f7ecc53
npm run query:pre-research -- --video-id=iKQ78wyJEXU --run-id 0a66f53c-5105-4d9a-86cb-d3e246896a17
npm run query:pre-research -- --video-id=s67bE2Ur3bY --run-id afb19547-afed-435a-a53f-68175b56cbbb
npm run query:pre-research -- --video-id=o6U_2vd967Y --run-id 20de9ea3-4386-4635-8611-7d08304cb885
npm run query:pre-research -- --video-id=tJFjeMBKbIY --run-id 9573ef99-38e6-44b9-b211-875f8d66a810
npm run query:pre-research -- --video-id=z0sh8HyTrDo --run-id 13ad277f-1e6c-4ce7-a71e-5ac0fc5f1a0d
npm run query:pre-research -- --video-id=pWXUkLP9uWM --run-id 55c86923-b0a3-419c-8212-b59c1dad734a
npm run query:pre-research -- --video-id=AMiyLItEtLA --run-id 8178aeeb-aa33-4f83-aa8c-520a02f1781c
npm run query:pre-research -- --video-id=AVMr9PMINyo --run-id c99b8675-1414-4638-9689-e52ec971637a
npm run query:pre-research -- --video-id=AQv3qRCG6Gw --run-id 389a656b-1ae3-48f2-a607-7e18c8df62b0
npm run query:pre-research -- --video-id=jWq-aZIU0kM --run-id d2ca6922-79f5-4896-b6e8-341259a03bc0
npm run query:pre-research -- --video-id=lCBf9slCanI --run-id c94afb6a-457c-4202-9a9d-b87f3cbe6c18
npm run query:pre-research -- --video-id=xbPriQWXtWM --run-id 5d048c95-e108-4f60-94ed-5c76a857c4b5
npm run query:pre-research -- --video-id=3ZMUiFaQ3qg --run-id 7875057c-1625-477b-8008-fa05a9f9c869
npm run query:pre-research -- --video-id=zkX03APVj0M --run-id 8c1d179c-a4ca-4787-89a4-a5b724485e68
npm run query:pre-research -- --video-id=2bvtay8wGYI --run-id 7c9f0422-90be-4489-8880-696e4f6dce2b
npm run query:pre-research -- --video-id=ewtOo0scUh0 --run-id ad52972c-1ca9-4d08-98e1-d18fbe9408dd
npm run query:pre-research -- --video-id=k35LeKZEhiE --run-id 57c5c06d-0101-4333-aede-807a63433b55
npm run query:pre-research -- --video-id=_PdK6x7PQNM --run-id 5d471dd0-db8f-4479-84c7-e74a463a95d7
npm run query:pre-research -- --video-id=cJ0EOzey--o --run-id 7b09a3d3-e827-42a1-9351-64a476ff887e
npm run query:pre-research -- --video-id=2aS7aKoXn64 --run-id 74c5e1db-6f3d-4a67-86ae-cc84899a7225
npm run query:pre-research -- --video-id=ZFxh7sqbUZo --run-id 77331219-f696-4109-84a1-c4be6e960b3a
npm run query:pre-research -- --video-id=-npY6XjM8CQ --run-id 53357029-8ea3-4dae-96e4-342483f8cf29
npm run query:pre-research -- --video-id=s4r6nk5WsZw --run-id 06ec3f95-dfbc-4757-88c8-ae258237a07a
npm run query:pre-research -- --video-id=-jY2T2PiJBE --run-id 0dc8ae0d-0dea-4740-a096-b2eca46e7584
npm run query:pre-research -- --video-id=jQDXzEVHMSE --run-id b5b47584-a684-4cd5-bd23-9626d37b8efb
npm run query:pre-research -- --video-id=RmS5s6Wbin4 --run-id d9f5dfe8-540e-40fd-aa0d-4903028887ca
npm run query:pre-research -- --video-id=QHBjufYK8TA --run-id 547b6c46-0f63-473d-a7ec-d4d840b81bda
npm run query:pre-research -- --video-id=J4_jCrTxMkk --run-id 89af43c3-f0f5-4af3-a7ca-dba44d66f106
npm run query:pre-research -- --video-id=CoEIs6Xm8m8 --run-id 5e18d312-252f-42ed-b38e-903f276528f5
npm run query:pre-research -- --video-id=LZuWZRze3MU --run-id d5daeefb-d1b0-4984-9a24-3040ddd263d9
npm run query:pre-research -- --video-id=FWMJQDH3iK0 --run-id 3453d6f1-8613-443a-896d-79bc3733b018
npm run query:pre-research -- --video-id=Z-c11pV_uvU --run-id d44aa9c2-b137-4778-bf8c-28c0e1038170

# When any current recoverable run becomes `applied`, verify that
# exact video/run pair with the same command form before adding it to the proof list:
# npm run query:pre-research -- --video-id=<video_id> --run-id <run_uuid>

# Full, untruncated queue accounting.
node scripts/list-eligible-videos.mjs --limit 1000 --summary

# Production deployment and recent scheduler/provider evidence.
npx --yes vercel@latest inspect https://research-starter-pre-research-agent.vercel.app --scope overtons-projects
npx --yes vercel@latest logs dpl_6y1p6jCqaSFB8SC6F47Jo7eYGkif --scope overtons-projects --since 30m --limit 200 --expand
```

The production alias, environment variables, Cron cadence, pause/resume procedure, deployment commands, advisory-lock semantics, review gate, and filesystem constraints are documented above. The queue is intentionally expected to outlive this coding session; the deployment is the worker that continues it.
