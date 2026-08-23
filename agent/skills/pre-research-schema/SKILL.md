---
description: Use before naming any Postgres object or writing packet files. This is the only schema this agent may use.
---

# Pre-research Postgres schema

Load the sibling file `references/postgres-schema.md` with `read_file` at `$HOME/.agents/skills/pre-research-schema/references/postgres-schema.md` if you need the full column list.

You may name only these objects:

## Source (read; executor completion write)

- `public.research_starter_videos` — catalog + transcript pointer/text. Read through `claim_pre_research_video` and `load_video_context`. Only the deterministic executor finalizer may set `pre_research_complete = true`, after receipt registration and pipeline finalization.

## Taxonomy (read)

- `public.research_taxonomy_version`
- `public.research_category_definition`
- `public.research_application_domain`
- `public.research_organization_domain_definition`

Read engineering/application taxonomy through `load_taxonomy`. Organization domains are in the `organization-taxonomy` skill.

## Orchestration (tools only)

- `public.research_pre_research_run`
- `public.research_pre_research_session`
- `public.research_pre_research_video_state`
- `public.research_pre_research_artifact`
- `research_private.claim_pre_research_video`
- `research_private.touch_pre_research_run`
- `research_private.begin_research_session`
- `research_private.complete_research_phase`
- `research_private.begin_synthesis_session`
- `research_private.complete_synthesis_phase`

Use the claim, load, touch, and packet tools. Do not write these tables yourself. Do not mark `pre_research_pipeline_finished`.

## Analysis (executor only)

The model proposes rows. The executor inserts them.

- `public.research_video_analysis`
- `public.research_video_initial_summary`
- `public.research_video_technology_summary`
- `public.research_video_category`
- `public.research_video_domain`
- `public.research_video_lifecycle`
- `public.research_evidence_anchor`
- `public.research_organization_candidate`
- `public.research_organization_source`
- `public.research_entity_candidate`
- `public.research_resource_candidate`
- `public.research_web_search_event` — scouts may append via `record_web_search_event`

## Intent ledger (save tool + executor)

- `public.research_ingestion_intent`
- `public.research_ingestion_intent_event`

## Storage

- Bucket `ai-engineer-transcripts` — read transcripts (`transcript_bucket` / `transcript_path`)
- Bucket `research-ingestion-intents` — write v2 packets under `pre-research/v2/<video_id>/<run_id>/`

## Forbidden

- Any `aiengineerapp` learner/entity table (`youtube_video`, `course`, `person`, `organization`, …)
- `execute_sql` operations
- Invented columns
- Putting `transcript_text` into packet or intent JSON
- Marking finished from an Eve session
