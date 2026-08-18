# Pre-research query map

Script: `scripts/query-pre-research.mts`. Storage client: `agent/lib/supabase-storage.ts`. Postgres: `agent/lib/postgres.ts`.

Packet prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`.

## Postgres

| Area | Tables |
| --- | --- |
| Catalog | `research_starter_videos` (no `transcript_text` in the default select) |
| Orchestration | `research_pre_research_video_state`, `research_pre_research_run`, `research_pre_research_session`, `research_pre_research_artifact` |
| Intent | `research_ingestion_intent`, `research_ingestion_intent_event` |
| Analysis | `research_video_analysis`, `research_video_initial_summary`, `research_video_technology_summary` |
| Taxonomy | `research_video_category`, `research_video_domain`, `research_video_lifecycle` |
| Orgs | `research_organization_candidate`, `research_organization_source` |
| Staging | `research_entity_candidate`, `research_resource_candidate`, `research_evidence_anchor`, `research_web_search_event` |
| Storage inventory | `storage.objects` for both buckets |

## Buckets

| Bucket | Path | Role |
| --- | --- | --- |
| `ai-engineer-transcripts` | `ai-dot-engineer/<video_id>.txt` | Caption file; SHA must match `research_pre_research_run.transcript_sha256` |
| `research-ingestion-intents` | `pre-research/v2/<video_id>/<run_id>/` | Twelve v2 packet files |

Artifact kinds: `run_manifest`, `transcript_analysis`, `taxonomy_classification`, `web_context`, `organization_research`, `source_verification`, `curriculum_signals`, `initial_summary`, `technology_library_summary`, `organization_profile`, `ingestion_intent`, `execution_receipt`.

## `--json` payload

Top-level keys: `ok`, `video`, `video_state`, `runs`, `selected_run`, `sessions`, `intent`, `intent_events`, `analysis`, `initial_summary`, `technology_summaries`, `categories`, `domains`, `lifecycle`, `organizations`, `organization_sources`, `entities`, `resources`, `evidence_anchors`, `web_searches`, `artifacts`, `produced`, `storage`.

`produced` is the short read: `companies`, `libraries_and_technologies`, `summaries`, `taxonomy`, `entities`, `resources`.

`storage.artifact_retrievals[].sha_matches` is the hash check against `research_pre_research_artifact.content_sha256`.

## Known finished example

- `video_id`: `-rsTkYgnNzM`
- Title: Rethinking how we Scaffold AI Agents — Rahul Sengottuvelu, Ramp
- `run_id`: `8e27309e-a7ec-4624-9225-16c404e17a62`
- Primary org: Ramp. Other: Cohere.io. Tech: code-interpreter + parallel sampling, LLM-as-backend, Jsonformer.
