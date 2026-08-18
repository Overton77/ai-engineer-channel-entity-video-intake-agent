---
name: query-pre-research
description: Query and verify research-starter pre-research outputs for an AI Engineer YouTube video. Reads Postgres analysis tables plus Supabase buckets research-ingestion-intents and ai-engineer-transcripts. Use after an Eve pipeline finishes, or when the user asks what a run produced (companies, libraries, summaries, taxonomy, artifacts).
---

# Query pre-research outputs

Cursor-side verification only. Do not use this from an Eve session. Do not write SQL, call Eve tools, or mark `pre_research_pipeline_finished`.

Work from `research_starter_pre_research_agent/`. Requires `.env` with `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Run the script

Execute `scripts/query-pre-research.mts`. Do not reimplement the query.

```bash
# human report (default)
npm run query:pre-research -- --video-id=-rsTkYgnNzM

# structured payload for follow-up reasoning
npm run query:pre-research -- --video-id=-rsTkYgnNzM --json

# pin a run
npm run query:pre-research -- --video-id=-rsTkYgnNzM --run-id 8e27309e-a7ec-4624-9225-16c404e17a62
```

YouTube ids may start with `-`. Always pass `--video-id=<id>` (equals form), never a bare positional id.

| Flag | When |
| --- | --- |
| `--json` | Need the full payload (companies, tech families, artifacts, storage hashes) |
| `--run-id <uuid>` | Video has more than one run; otherwise latest / `latest_run_id` |
| `--include-artifacts` | Need packet JSON bodies from `research-ingestion-intents` |
| `--include-transcript` | Need full caption text from `ai-engineer-transcripts` (large) |

Default report already lists companies, libraries, summaries, taxonomy, entity/resource names, bucket inventory, and artifact hash checks. Prefer that over `--include-*` unless the user asks for raw bodies.

## What to report

After the command succeeds, answer from its output. Cover:

1. Video title, `run_id`, `run_status`, intent status, finished flag
2. Companies (primary featured + others)
3. Libraries / technology families
4. Transcript-only vs contextualized summaries
5. Taxonomy (form, difficulty, primary category, domains)
6. Storage: transcript SHA match, packet object count, any `MISSING` / `HASH_MISMATCH` artifacts

A finished applied run should show `run_status=applied`, `intent_status=applied`, `finished=true`, twelve listed packet objects, and `[ok]` on every artifact retrieval.

`eligibility=ineligible` after finish is expected (already processed). That is not a failure.

## Do not

- Query `aiengineerapp` learner tables (`youtube_video`, `course`, `person`, `organization`, …)
- Download every transcript by default
- Treat local `outputs/pre-research/` as source of truth; verify Supabase + Postgres
- Start Eve or apply intents (that is a different skill)

## Additional resources

- Table, bucket, and payload map: [reference.md](reference.md)
- Pipeline runner (Eve sessions): `.cursor/skills/run-pre-research/SKILL.md`
