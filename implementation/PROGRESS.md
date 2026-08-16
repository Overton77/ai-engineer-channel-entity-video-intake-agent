# Implementation progress

Last updated: 2026-08-16  
Current mission: [SCOPE.md](./SCOPE.md) — **approved 2026-08-16, code shipped**  
Current slice: all six slices landed. Live GLM/Exa smoke is the next session, not this one.

## Mission outcome

The v2 vertical slice is in the repo and the schema is live on Supabase `wkythqbofmckbuoothhn`. A later session can start Eve and run one qualified video through `scripts/run-pre-research-pipeline.mjs`.

Live smoke was explicitly out of this mission. Do not treat the missing GLM/Exa run as a blocker for the code.

## Slice status

| Slice | Status | Notes |
| --- | --- | --- |
| 1 Schema + qualification | done | Local file `supabase/migrations/20260816205231_pre_research_v2_schema.sql`. Applied remotely in chunks (see below). |
| 2 Contracts + helpers | done | Packet/intent/receipt `2.0.0`, canonical JSON + SHA-256, URL + org invariants |
| 3 Durable packet tools | done | Storage upload, `save_research_phase_packet`, `load_research_phase_packet`, `save_pre_research_packet` |
| 4 Eve phase split | done | Dynamic phase instructions, `organization_researcher`, `maxSubagents: 6` |
| 5 Controller + executor | done | `controller/pre-research-pipeline.ts` + real `executor/apply-intent.ts`. No second Workflow package. |
| 6 Runner, docs, unit tests | done | `npm test` 29/29, `npm run typecheck` pass. Operator docs point at the pipeline. |

## Remote schema apply

The local migration is one file. MCP `apply_migration` needed smaller chunks because `ALTER TYPE ADD VALUE` must commit before the new enum values are used, and the full file is large.

Applied on `wkythqbofmckbuoothhn` as:

1. `pre_research_v2_schema_tables`
2. `pre_research_v2_run_index_and_session`
3. `pre_research_v2_summary_tables`
4. `pre_research_v2_organization_enums`
5. `pre_research_v2_org_tables_and_artifacts`
6. `pre_research_v2_org_domain_seed` — 27 organization-domain rows
7. `pre_research_v2_qualification_functions`
8. `pre_research_v2_claim_rpc` — 6-arg claim; 5-arg overload dropped
9. `pre_research_v2_phase_and_feed` — phase RPCs, finished feed, grants

Live unique index uses enum `status in (...)`, not `status::text` (Postgres rejected `::text` as non-IMMUTABLE). Session inserts are `on conflict (eve_session_id) do update`.

Temp split files `.v2-part1.sql` / `.v2-part2.sql` were deleted after apply.

## Qualification smoke (SQL only, no Eve)

`refresh_pre_research_video_qualification()` on the full catalog: **43 eligible / 1006 ineligible / 1049 evaluated**.

Specific-id claim cannot bypass qualification:

| video_id | Result |
| --- | --- |
| `TRjq7t2Ms5I` | `claimed: false`, `VIDEO_ALREADY_CLAIMED_OR_FINISHED` (`already_live_for_current_transcript`) |
| `_zdroS0Hc74` | `claimed: false`, `VIDEO_TOO_LONG` (`duration_at_or_over_5400_seconds`) |

`TRjq7t2Ms5I` has a leftover **v1** run `0af07c2e-bb23-46e1-9661-0a32c67a3715` in `intent_ready` (packet `1.0.0`). Do not reclaim it. Next oldest eligible row: **`-rsTkYgnNzM`**.

## Files that matter

| Concern | Path |
| --- | --- |
| Additive v2 SQL | `../supabase/migrations/20260816205231_pre_research_v2_schema.sql` |
| Controller | `../controller/pre-research-pipeline.ts` |
| Pipeline CLI | `../scripts/run-pre-research-pipeline.mjs` |
| Executor | `../executor/apply-intent.ts` |
| Contracts | `../contracts/` |
| Packet tools | `../agent/tools/save_research_phase_packet.ts`, `load_research_phase_packet.ts`, `save_pre_research_packet.ts` |
| Operator handoff | `../HANDOFF.md` |
| Runner skill | `../.cursor/skills/run-pre-research/SKILL.md` |

## Verification already run

- `npm test` — 29/29
- `npm run typecheck` — pass
- `npm run build` (`eve build`) — succeeded earlier in this mission
- Claim predicates reject live v1 run and duration ≥ 5400
- `--video-id` path uses the same qualification function as the queue

## Leftover risk (do not expand this mission)

- Live GLM/Exa smoke has not been run
- `touch_pre_research_run` TypeScript status enum is still v1-shaped on purpose: Eve must not set `research_complete` / `synthesizing` / finished
- Remote history is chunked migrations; local source of truth is the single `20260816205231_…` file
- v1 `intent_ready` rows occupy the live unique index for that transcript hash until superseded or applied
- Production schedule is still disabled; keep it that way

## Decisions already locked

- Packet `2.0.0`, prompt bundle `pre-research-2.0.0`
- Finished marker spelling: `pre_research_pipeline_finished`
- Two Eve root sessions; controller owns the cutover
- Organization attribution: narrowest owning unit, parent separate, speaker employer separate
- Durability is DB phase RPCs, not a second Eve project or a new `workflow` package
- Migrations live in `supabase/migrations/`, not inside the Eve app directory

## Blockers

None for the approved code mission. Next session needs `.env` (`AI_GATEWAY_API_KEY`, `POSTGRES_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and a running `eve dev --no-ui --port 2000`.
