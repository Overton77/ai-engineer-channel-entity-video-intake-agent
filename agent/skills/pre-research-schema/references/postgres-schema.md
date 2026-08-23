# Postgres objects for research_starter_pre_research_agent

Applied by `supabase/migrations/20260815015402_research_pre_research_schema.sql` plus `20260816205231_pre_research_v2_schema.sql`.

Packet schema `2.0.0`. Prompt bundle `pre-research-2.0.0`.

## Enums

- `research_engineering_category_code`: model_foundations_behavior, inference_model_systems, ai_data_engineering, post_training_continual_learning, prompting_llm_programming, context_engineering_memory, retrieval_search_knowledge, agent_architecture_harnesses, tools_protocols_integrations, orchestration_durable_execution, coding_agents_software_engineering, evaluation_testing_benchmarking, observability_reliability_llmops, security_safety_identity_governance, multimodal_realtime_systems, ai_product_ux_human_factors, ai_platforms_developer_tooling
- `research_pre_research_run_status`: queued, claimed, analyzing, research_complete, synthesizing, intent_ready, applying, applied, review_required, failed, superseded
- `research_organization_domain_code`: frontier_model_lab, applied_ai_research_lab, cloud_ai_platform, ai_compute_hardware_systems, model_training_inference_platform, ai_data_curation_training_platform, database_data_ai_platform, retrieval_knowledge_platform, agent_framework_orchestration, ai_developer_platform_sdk, coding_agents_developer_tools, evaluation_observability_llmops, ai_security_identity_governance, multimodal_voice_media_ai, robotics_embodied_edge_ai, enterprise_ai_automation, horizontal_ai_application, vertical_ai_application, open_source_ai_ecosystem, ai_protocol_standards_body, academic_nonprofit_research, ai_services_consulting, ai_community_education_media, ai_adopting_product_company, general_technology_ai_unit, diversified_technology_company, other_unknown
- `research_organization_scope`: independent_company, parent_company, subsidiary, division, research_lab, product_organization, standards_body, academic_institution, nonprofit, community_education_media, other
- `research_video_organization_role`: primary_featured_organization, implementation_owner, speaker_employer, parent_organization, subsidiary_or_division, acquisition_party, partner, customer_or_internal_user, standards_steward, mentioned_only
- `research_category_assignment_role`: primary, secondary
- `research_difficulty`: introductory, intermediate, advanced, expert
- `research_content_form`: talk, tutorial, demo, panel, interview, workshop, keynote
- `research_evidence_level`: anecdotal, case_study, benchmarked, production_system, research_paper
- `research_lifecycle_stage`: research, design, implementation, evaluation, deployment, operations, governance
- `research_evidence_source_kind`: transcript, description, web
- `research_verification_status`: verified, likely, uncertain, rejected
- `research_resource_type`: repository, code_example, documentation, paper, article, slides, dataset, benchmark, model, demo, course, other
- `research_entity_kind`: person, organization, product, model, protocol, dataset, benchmark, paper, repository, other
- `research_intent_status`: draft, validated, applied, rejected

Temporal status (contract/check, not a Postgres enum): current, changed_since_publication, historical, uncertain.

## Source table

`research_starter_videos(video_id pk, title, description, published_at, channel_*, duration*, url, transcript_status, transcript_bucket, transcript_path, transcript_language, transcript_char_count, transcript_text, pre_research_complete, metadata, ...)`

`pre_research_complete` is set only by the deterministic executor after successful intent application, execution-receipt registration, and final pipeline-state projection. It defaults to `false`.

Eligible claim rows: `transcript_status = 'stored'`, non-empty `transcript_text`, `transcript_bucket = 'ai-engineer-transcripts'`, matching `storage.objects` row, and `duration_seconds` in `(0, 5400)`.

## Run, session, and finish state

`research_pre_research_run(..., research_as_of date, packet_schema_version, packet_storage_prefix, packet_sha256, research_session_id, synthesis_session_id, research_completed_at, synthesis_started_at, ...)`

`research_pre_research_session(pre_research_session_id, run_id, phase research|synthesis, attempt, eve_session_id unique, status started|completed|failed|cancelled, ...)` unique `(run_id, phase, attempt)`

`research_pre_research_video_state(video_id pk, transcript_sha256, eligibility_status, ineligibility_reasons, duration_seconds, transcript_object_exists, latest_run_id, pipeline_status, pre_research_pipeline_finished, pre_research_pipeline_finished_at, finished_transcript_sha256, finished_intent_id, ...)`

`pre_research_pipeline_finished = true` requires finish timestamp, finished transcript hash, finished intent, and `pipeline_status = 'finished'`. Eve sessions must never set this.

Target run lifecycle:

```
queued -> claimed -> analyzing -> research_complete -> synthesizing
       -> intent_ready/review_required -> applying -> applied
```

## Taxonomy lookups

`research_taxonomy_version`
`research_category_definition`
`research_application_domain`
`research_organization_domain_definition(domain_code pk, label, description, inclusion_criteria[], exclusion_criteria[], example_organizations[], active, sort_order, definition_version)`

## Analysis tables (executor writes)

`research_video_analysis` — transcript-only analysis; keep `initial_summary` for provenance

`research_video_initial_summary(analysis_id pk, video_id, transcript_summary, software_engineering_concepts jsonb, ai_concepts jsonb, external_context_notes jsonb, temporal_context, research_as_of, evidence_ids, generated_at)`

`research_video_technology_summary(technology_summary_id, analysis_id, video_id, family_rank, family_label, primary_technology, primary_technology_kind, related_technologies, implementations, summary, relationship_rationale, role_in_video, current_status, temporal_status, video_published_at, research_as_of, official_urls, evidence_ids, confidence, generated_at)` unique `(analysis_id, family_rank)`

`research_video_category` / `research_video_domain` / `research_video_lifecycle`

`research_evidence_anchor`

`research_organization_candidate(organization_candidate_id, analysis_id, video_id, canonical_name, normalized_name, organization_scope, relationship_roles, is_primary_featured, featured_rank, primary_domain_code, secondary_domain_codes, parent_name, parent_canonical_url, official_url, authoritative_summary, relationship_to_implementation, current_status, status_as_of, video_time_name, video_time_parent_name, ownership_changed_since_video, confidence, evidence_ids, generated_at)` unique `(analysis_id, normalized_name)`. Exactly one primary/rank-1 featured organization per analysis.

`research_organization_source(organization_source_id, organization_candidate_id, source_rank, source_role, authority_tier, title, publisher, url, normalized_url, publicly_retrievable, retrieved_at, source_published_at, supports, verification_status, is_required_core_source, evidence_id)` unique `(organization_candidate_id, normalized_url)`

`research_entity_candidate` / `research_resource_candidate` — staging only

`research_web_search_event(run_id, subagent organization_researcher|web_context_scout|source_verifier, query, provider exa, result_urls, selected_urls, search_purpose)`

## Artifact registry

`research_pre_research_artifact(artifact_id, run_id, intent_id, artifact_kind, schema_version, storage_bucket, storage_path, content_sha256, byte_count, created_at)` unique `(run_id, artifact_kind)` and `(storage_bucket, storage_path)`

Twelve v2 artifact kinds: `run_manifest`, `transcript_analysis`, `taxonomy_classification`, `web_context`, `organization_research`, `source_verification`, `curriculum_signals`, `initial_summary`, `technology_library_summary`, `organization_profile`, `ingestion_intent`, `execution_receipt`.

Register only after a successful upload.

## Intent ledger

`research_ingestion_intent`
`research_ingestion_intent_event`

## Private functions

`research_private.claim_pre_research_video(...)` — writes UTC `research_as_of` and v2 packet version for new runs
`research_private.touch_pre_research_run(...)`
`research_private.refresh_pre_research_video_qualification(p_video_id text default null)`
`research_private.begin_research_session(run_id, eve_session_id)`
`research_private.complete_research_phase(run_id, eve_session_id)`
`research_private.begin_synthesis_session(run_id, eve_session_id)`
`research_private.complete_synthesis_phase(run_id, eve_session_id, next_status)`
`research_private.list_finished_pre_research_videos`

Phase RPCs lock the run, enforce legal prior status, verify the current transcript hash, and update the session ledger. `complete_research_phase` verifies registered `00`–`50` hashes. `begin_synthesis_session` is the only path into `synthesizing`.

## Indexes that matter

- Live unique `(video_id, transcript_sha256)` while status in queued/claimed/analyzing/research_complete/synthesizing/intent_ready/applying
- Applied unique `(video_id, transcript_sha256)` while status = applied
- Eligible catalog `(published_at ASC NULLS LAST, video_id ASC)` for stored transcripts under 5400 seconds
- One primary category per analysis
- One primary featured organization per analysis
