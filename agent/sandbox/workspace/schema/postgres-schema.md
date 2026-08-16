See `$HOME/.agents/skills/pre-research-schema/references/postgres-schema.md` for the live column list.

This agent may name only `public.research_*` tables, `research_private` claim/touch/phase/qualification functions, and the source table `public.research_starter_videos`.

v2 objects include `research_pre_research_session`, `research_pre_research_video_state`, `research_pre_research_artifact`, `research_video_initial_summary`, `research_video_technology_summary`, `research_organization_domain_definition`, `research_organization_candidate`, and `research_organization_source`.

Twelve packet artifact kinds: `run_manifest`, `transcript_analysis`, `taxonomy_classification`, `web_context`, `organization_research`, `source_verification`, `curriculum_signals`, `initial_summary`, `technology_library_summary`, `organization_profile`, `ingestion_intent`, `execution_receipt`.

Do not name aiengineerapp tables. Do not write SQL. Do not set `pre_research_pipeline_finished`.
