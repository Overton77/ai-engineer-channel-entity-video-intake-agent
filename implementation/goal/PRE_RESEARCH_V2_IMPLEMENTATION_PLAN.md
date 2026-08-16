# Pre-research v2 implementation plan

Date prepared: 2026-08-16  
Target agent: `research_starter_pre_research_agent` on Eve, `zai/glm-5.2`  
Search path: Eve `web_search` with provider `exa` through Vercel AI Gateway  
Database boundary: the existing `public.research_*` and `research_private` objects in the shared Supabase database

## 1. Outcome and non-negotiable decisions

This system performs pre-research, categorization, and summarization. Each qualified AI Engineer YouTube video must produce four distinct, durable outcomes:

1. **Video categorization:** the official AI-engineering category, secondary categories, application domains, lifecycle stages, difficulty, and content form.
2. **Video/transcript summary:** a transcript-grounded account of what the video says, followed after research by a contextualized initial summary of the video and its software-engineering and AI concepts. 
3. **Technology/library/tool summary:** the main technology or technologies and the libraries, SDKs, frameworks, tools, services, and products that implement them. Naturally connected suites such as LlamaIndex, LlamaCloud, and LlamaParse stay grouped.
4. **Organization intelligence:** identify and categorize the narrowest relevant company, AI division, lab, subsidiary, or product organization; explain its authoritative relationship to the implementation in the talk; and attach its most important authoritative, publicly retrievable sources.

The final `90-ingestion-intent.json` contains allowlisted operations representing all rows to be created. A deterministic executor—not the model—validates that file and builds the pre-research/starter-research tables from it.

Use these implementation decisions throughout:

- Keep `zai/glm-5.2`. Do not add another model to this agent.
- Keep Eve's built-in `web_search({ provider: "exa" })`. Do not require `EXA_API_KEY` and do not add a paid research tool to this agent.
- Keep the pre-research schema isolated from the aiengineerapp entity/learner schema even though both live in the same database.
- Treat the intent file as the model-to-database contract and durable audit record.
- Generate the new summaries only after transcript analysis, taxonomy classification, web context, and source verification are complete.
- Prefer the narrowest authoritative organization that actually owns or builds the discussed implementation. An AI-focused division, lab, or subsidiary outranks a broad parent conglomerate. A product name alone is not an organization; use a product organization only when first-party evidence establishes it as a stable named organizational unit.
- Keep organization, parent organization, speaker affiliation, and featured product/implementation as separate facts. Do not categorize Microsoft when the evidence supports GitHub as the relevant organization, or Amazon retail when the evidence supports AWS or Amazon AGI Lab.
- Use one Eve project and one Vercel deployment, but two deterministically started root sessions per video: a research session followed by a clean synthesis session.
- Do not let the research model decide when to call a summary subagent. Trusted controller code validates the research checkpoint and starts the synthesis session only after the run is durably `research_complete`.
- The synthesis session uses the same `zai/glm-5.2` root agent with phase-specific instructions and no research subagents. Do not create a second Eve project or enable the generic copy-agent for this stage.
- Process videos by `published_at ASC NULLS LAST, video_id ASC`. This preserves the existing oldest-first runner behavior and makes the ordering identical in every entry point.
- A video is eligible only if it has usable transcript data and `duration_seconds < 5400`. Exactly 1:30:00 is excluded because the requirement says “under” 1 hour 30 minutes.
- Use the correctly spelled `pre_research_pipeline_finished`. Do not introduce `pre_reseach_pipeline_finished`.
- Put the finished marker in a one-to-one connection/state table instead of directly on `research_starter_videos`. Completion must be tied to the transcript SHA-256 so replacing a transcript automatically makes the previous completion stale.
- Define “finished” narrowly: the validated intent has been applied, all required packet artifacts including the execution receipt are durable in `research-ingestion-intents`, and the finish state points to the exact run, intent, and transcript hash.

## 2. Current-state audit

The repository already has useful foundations:

- The current `research_starter_videos` catalog contains 1,049 rows. Its titles explicitly include organization/unit/product distinctions such as GitHub Copilot/Microsoft, Azure AI/Microsoft, AWS/Amazon, Amazon AGI Lab/Amazon, Google DeepMind/Google, Meta Superintelligence Labs/Meta, Anthropic/Claude Code, and OpenAI/Agents SDK/Codex; the organization taxonomy below is grounded in these catalog patterns.
- `research_private.claim_pre_research_video` uses `FOR UPDATE SKIP LOCKED`, hashes transcripts, and orders automatic claims oldest first in the latest migration.
- The root Eve agent runs GLM 5.2 and coordinates transcript, taxonomy, web, verification, and curriculum specialists.
- Zod contracts allowlist intent operations and prohibit model-generated SQL.
- `research-ingestion-intents` exists as a private bucket.
- `research_pre_research_run`, intent ledger, analysis, category, domain, lifecycle, evidence, resource, and entity tables already exist.
- The runner processes one Eve session per video sequentially and stops after a failed turn.

The v2 implementation must close these gaps:

- The claim RPC checks only `transcript_status` and non-empty `transcript_text`; it does not require the expected bucket, a real `storage.objects` row, or the duration ceiling.
- Specific-ID claims can bypass the storage-object and duration rules.
- `scripts/eligible-videos.mjs` verifies the storage object but does not enforce duration and does not compare run completion to the current transcript hash.
- The schedule prompt does not precompute a qualified queue; it relies on the incomplete claim RPC.
- `save_pre_research_intent` writes the intent locally and to the Eve sandbox but does not upload it to Supabase Storage. It nevertheless records a bucket path in Postgres.
- Only `90-ingestion-intent.json` is handed to the save tool. The full `00`–`90` packet is not durably persisted.
- `executor/apply-intent.ts` is a stub, so the existing research analysis tables are not actually built from the intent.
- The current `initial_summary` is transcript-only and is produced before web context. It must remain available for provenance, but it does not satisfy the new post-research contextualized-summary requirement.
- There is no first-class technology/library family output.
- Organization entities are currently generic candidates. There is no organization-domain enum, no parent/unit/product attribution rule, no final organization profile, and no minimum authoritative-source contract.
- Prompts and contracts do not carry a runtime `research_as_of` date or distinguish current, historical, changed, and uncertain technology status.
- No transcript-hash-aware pipeline-finished marker exists.
- Research and post-research synthesis currently occur inside one model-driven turn. There is no deterministic, durable `research_complete` checkpoint or independently retryable synthesis session.

## 3. Target packet and processing flow

Use packet schema version `2.0.0` and prompt bundle version `pre-research-2.0.0`. Do not rewrite old v1 artifacts; the executor should dispatch by schema version during migration and may support v1 until the backlog is cleared.

```text
catalog/transcript ingest
  -> deterministic qualification snapshot
  -> atomic claim, oldest published video first
  -> controller starts RESEARCH SESSION
       -> load transcript + taxonomy + runtime research_as_of
       -> wave 1: transcript analyst, taxonomy classifier, web context scout, organization researcher, curriculum mapper
       -> wave 2: source verifier
       -> validate and upload durable 00-50 research checkpoint, including organization research
  -> controller verifies artifact hashes and marks research_complete
  -> controller starts NEW SYNTHESIS SESSION for the same run
       -> load verified 00-50 packet from durable storage
       -> contextualized initial summary (60)
       -> technology/library family summary (70)
       -> organization profile and domain classification (80)
       -> ingestion intent (90)
  -> validate complete packet and cross-file invariants
  -> upload 60-90 to research-ingestion-intents
  -> record validated intent ledger row
  -> deterministic executor downloads 90, validates, and applies operations
  -> upload 99-execution-receipt.json
  -> mark current transcript's pipeline state finished
  -> expose the applied result to deep research/curriculum/official ingestion
```

Durable bucket layout:

```text
research-ingestion-intents/
  pre-research/v2/<video_id>/<run_id>/
    00-run-manifest.json
    10-transcript-analysis.json
    20-taxonomy-classification.json
    30-web-context.json
    35-organization-research.json
    40-source-verification.json
    50-curriculum-signals.json
    initial-summary/
      60-initial-summary.json
    technology-library-summary/
      70-technology-library-summary.json
    organization-profile/
      80-organization-profile.json
    90-ingestion-intent.json
    99-execution-receipt.json
```

Do not store raw transcript text in this bucket. Store transcript bucket/path, transcript hash, evidence offsets, and short excerpts only.

## 4. Migration plan

Create one additive migration after `20260815021906_claim_pre_research_video_digest_search_path.sql`, followed by a separate data backfill migration only after the code is deployed. Never edit an already-applied migration.

### 4.1 Run metadata

Add to `public.research_pre_research_run`:

- `research_as_of date NOT NULL DEFAULT (timezone('utc', now())::date)`
- `packet_schema_version text NOT NULL DEFAULT '1.0.0'`
- `packet_storage_prefix text`
- `packet_sha256 text` for a deterministic manifest hash
- `research_session_id text`
- `synthesis_session_id text`
- `research_completed_at timestamptz`
- `synthesis_started_at timestamptz`

Extend `research_pre_research_run_status` additively with `research_complete` and `synthesizing`. The target lifecycle is:

```text
queued -> claimed -> analyzing -> research_complete -> synthesizing
       -> intent_ready/review_required -> applying -> applied
```

The state-table projection may use the clearer external label `researching` for run status `analyzing`. Do not use `intent_ready` as a substitute for `research_complete`.

The claim function must explicitly write the UTC date and v2 packet version for new runs. The date comes from trusted runtime/database time, not from the model. Deprecate the ambiguous single `workflow_session_id` for v2 reads; retain it temporarily for v1 compatibility while writing the two explicit session IDs above.

Create `public.research_pre_research_session` to preserve session attempts rather than keeping only the latest IDs:

```text
pre_research_session_id uuid primary key
run_id uuid -> research_pre_research_run.run_id on delete cascade
phase text: research | synthesis
attempt integer not null
eve_session_id text not null unique
status text: started | completed | failed | cancelled
started_at / completed_at
error_code / error_detail
result_summary jsonb
unique (run_id, phase, attempt)
```

The two session-ID columns on the run are current-pointer conveniences. This session table is the retry/audit history.

### 4.2 Transcript-hash-aware qualification and completion state

Create `public.research_pre_research_video_state` as the one-to-one connection table:

```text
video_id text primary key -> research_starter_videos.video_id
transcript_sha256 text null
eligibility_status text: pending | eligible | ineligible
ineligibility_reasons text[]
duration_seconds integer null
transcript_object_exists boolean not null default false
evaluated_at timestamptz
latest_run_id uuid null -> research_pre_research_run.run_id
pipeline_status text: not_started | eligible | claimed | researching |
                      research_complete | synthesizing | intent_ready |
                      review_required | applying |
                      finalizing | finished | failed | superseded
pre_research_pipeline_finished boolean not null default false
pre_research_pipeline_finished_at timestamptz null
finished_transcript_sha256 text null
finished_intent_id uuid null -> research_ingestion_intent.intent_id
created_at / updated_at
```

Add checks so `pre_research_pipeline_finished = true` requires a finish timestamp, finished transcript hash, finished intent, and `pipeline_status = 'finished'`. Add a check for 64-character lowercase SHA-256 values. Enable RLS, grant no anon/authenticated access, and use the existing updated-at trigger.

This table is an operational projection, not the historical source of truth. `research_pre_research_run` and `research_ingestion_intent` remain the history. When the transcript hash changes, qualification refresh must set `pre_research_pipeline_finished = false`, clear the prior finish pointers, and retain the old applied run in history.

### 4.3 Contextualized initial-summary table

Create `public.research_video_initial_summary`:

```text
analysis_id uuid primary key -> research_video_analysis.analysis_id on delete cascade
video_id text -> research_starter_videos.video_id
transcript_summary text not null
software_engineering_concepts jsonb not null default []
ai_concepts jsonb not null default []
external_context_notes jsonb not null default []
temporal_context text not null
research_as_of date not null
evidence_ids uuid[] not null default {}
generated_at timestamptz not null
```

Each concept item should be structured, not a bare string:

```json
{
  "name": "retrieval-augmented generation",
  "explanation": "How the video uses or explains it",
  "importance": "Why it matters to the system in the talk",
  "evidence_ids": ["uuid"],
  "evidence_grade": "said_in_transcript"
}
```

Retain `research_video_analysis.initial_summary` as the earlier transcript-only analysis for backward compatibility and provenance. Treat `research_video_initial_summary.transcript_summary` as the preferred post-research transcript summary for downstream agents. Research may clarify names, dates, and context, but must not silently inject externally sourced claims into what the speaker/video said; keep those in `external_context_notes` with evidence grades.

### 4.4 Technology/library summary table

Create `public.research_video_technology_summary` with one or more ranked technology families per analysis:

```text
technology_summary_id uuid primary key
analysis_id uuid -> research_video_analysis.analysis_id on delete cascade
video_id text -> research_starter_videos.video_id
family_rank integer not null
family_label text not null
primary_technology text not null
primary_technology_kind text not null
related_technologies jsonb not null default []
implementations jsonb not null default []
summary text not null
relationship_rationale text not null
role_in_video text not null
current_status text not null
temporal_status text: current | changed_since_publication | historical | uncertain
video_published_at timestamptz null
research_as_of date not null
official_urls jsonb not null default []
evidence_ids uuid[] not null default {}
confidence numeric(4,3) not null
generated_at timestamptz not null
unique (analysis_id, family_rank)
```

`primary_technology_kind` and related items must distinguish conceptual technologies (`architecture`, `technique`, `protocol`, `model_family`, `platform_capability`) from concrete implementations. `implementations` contains structured entries with `name`, `implementation_type` (`library`, `framework`, `sdk`, `tool`, `service`, `platform`, `product`, `protocol`, `model`, `repository`, or `other`), `implementing_organization_candidate_id`, `relationship_to_technology`, `role_in_video`, `current_status`, `official_url`, `evidence_ids`, and `confidence`.

Do not treat a brand name as the technology when the talk is actually about a broader method. For example, retrieval-augmented generation may be the technology, while LlamaIndex, LlamaCloud, and LlamaParse are a connected implementation suite. Conversely, if the video is explicitly a product architecture deep dive, that product may be the primary technology family. Allow several rows only when the talk genuinely has several unrelated primary technology families.

### 4.5 Organization-domain enum, hierarchy, profiles, and sources

Add the stable Postgres enum `public.research_organization_domain_code`. It classifies an organization or organization unit by its primary role in the AI-engineering value chain, not by the topic of one video and not by a conventional industry vertical.


| Enum code                            | Precise inclusion rule                                                                                                                                                                                        | Catalog-shaped examples                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `frontier_model_lab`                 | Develops general-purpose frontier/foundation models as a core organizational mission, including the dedicated unit that owns them.                                                                            | Anthropic, OpenAI, Google DeepMind, Mistral AI, Cohere, Meta Superintelligence Labs, Amazon AGI Lab when it is the evidenced unit |
| `applied_ai_research_lab`            | Primarily conducts AI research or translates research into prototypes, but is not best described as a commercial frontier-model provider.                                                                     | FAIR-like labs, independent applied-research labs                                                                                 |
| `cloud_ai_platform`                  | Hyperscale or broad cloud organization whose AI services, managed model access, and enterprise platform are the relevant implementation context.                                                              | AWS, Microsoft Azure AI                                                                                                           |
| `ai_compute_hardware_systems`        | Designs accelerators, chips, servers, or tightly coupled AI compute systems.                                                                                                                                  | NVIDIA, Groq, Cerebras, SambaNova, AMD                                                                                            |
| `model_training_inference_platform`  | Provides model training, fine-tuning, serving, inference, routing, or elastic AI runtime infrastructure rather than primarily designing chips.                                                                | Together AI, Modal, Replicate, Fireworks AI, Anyscale, OpenRouter                                                                 |
| `ai_data_curation_training_platform` | Provides labeling, curation, synthetic data, data quality, feedback, or training-data infrastructure.                                                                                                         | Scale AI, Snorkel                                                                                                                 |
| `database_data_ai_platform`          | General database, warehouse, graph, streaming, or data platform with a material AI engineering product surface.                                                                                               | MongoDB, Supabase, Databricks, Snowflake, Redis, ClickHouse, Neo4j when the database platform is central                          |
| `retrieval_knowledge_platform`       | Primarily builds retrieval, indexing, vector search, RAG, knowledge, or context infrastructure.                                                                                                               | LlamaIndex, Pinecone, Weaviate, Qdrant, Voyage AI                                                                                 |
| `agent_framework_orchestration`      | Primarily builds agent frameworks, control planes, workflow orchestration, memory, or durable execution for AI agents.                                                                                        | LangChain/LangGraph, agent-framework companies, Prefect when AI orchestration is the evidenced unit/product                       |
| `ai_developer_platform_sdk`          | Provides broad SDKs, gateways, APIs, sandboxes, deployment primitives, or developer platforms for building AI systems, without a narrower category dominating.                                                | Vercel AI SDK/platform, Cloudflare AI developer platform, general AI API platforms                                                |
| `coding_agents_developer_tools`      | Builds AI coding agents, IDE/terminal/PR tools, code intelligence, or AI-first software-engineering products.                                                                                                 | GitHub, Cursor, Windsurf, Sourcegraph/Amp, Replit                                                                                 |
| `evaluation_observability_llmops`    | Primarily builds AI evaluation, tracing, experimentation, observability, monitoring, or reliability products.                                                                                                 | Arize, Braintrust, Langfuse, Galileo, Weights & Biases; AI-specific Datadog/Sentry units when evidenced                           |
| `ai_security_identity_governance`    | Primarily builds AI security, authorization, identity, policy, guardrails, red teaming, compliance, or governance systems.                                                                                    | AI-focused WorkOS, Pomerium, security/governance vendors or units                                                                 |
| `multimodal_voice_media_ai`          | Primarily builds voice, speech, audio, image, video, generative-media, or realtime multimodal AI products/platforms.                                                                                          | ElevenLabs, Cartesia, Runway and comparable organizations                                                                         |
| `robotics_embodied_edge_ai`          | Primarily builds robotics, embodied agents, computer-vision/physical systems, or on-device/edge AI platforms.                                                                                                 | robotics companies, Roboflow-like vision platforms, dedicated edge-AI units                                                       |
| `enterprise_ai_automation`           | Primarily sells AI automation, enterprise knowledge work, support, search, productivity, or workflow systems to organizations.                                                                                | enterprise agent/automation and workplace-AI companies                                                                            |
| `horizontal_ai_application`          | Builds an AI-native end-user application spanning many industries and not better classified as enterprise automation, coding, or media.                                                                       | general AI assistants/search/productivity applications                                                                            |
| `vertical_ai_application`            | Builds an AI-native product for a specific industry or professional domain. The conventional vertical remains a separate `research_application_domain`.                                                       | healthcare, legal, finance, education, or other vertical AI startups                                                              |
| `open_source_ai_ecosystem`           | Stewardship of open models, libraries, hubs, communities, or distribution is the defining organizational role.                                                                                                | Hugging Face and comparable open AI ecosystems                                                                                    |
| `ai_protocol_standards_body`         | Stewards an AI protocol, specification, interoperability standard, or neutral technical governance group.                                                                                                     | MCP steering/standards organizations when they—not a vendor—are the featured body                                                 |
| `academic_nonprofit_research`        | University, academic lab, nonprofit institute, or public-interest research organization.                                                                                                                      | UC Berkeley labs and comparable institutions                                                                                      |
| `ai_services_consulting`             | Primarily provides AI implementation services, consulting, agencies, or systems integration rather than a repeatable AI product/platform.                                                                     | consultancies and agencies                                                                                                        |
| `ai_community_education_media`       | Primarily operates AI education, events, media, professional community, or training.                                                                                                                          | AI Engineer when it is itself the organization being discussed                                                                    |
| `ai_adopting_product_company`        | The featured organization primarily operates a non-AI product/business and the talk explains its internal application of AI.                                                                                  | Booking.com, Pinterest, Uber, Amazon retail/recommendations when no narrower AI unit owns the implementation                      |
| `general_technology_ai_unit`         | A dedicated AI/product unit inside a broad technology company that is real and authoritative but does not fit a narrower value-chain category. Use sparingly.                                                 | a formally named Google, Microsoft, Meta, IBM, or Oracle AI unit with broad scope                                                 |
| `diversified_technology_company`     | Broad technology parent/holding company recorded for hierarchy, where no single AI value-chain role describes the parent as a whole. Do not use when a narrower AI unit is the primary featured organization. | Microsoft, Alphabet/Google, Amazon, Meta, IBM, Oracle when recorded as broad parents                                              |
| `other_unknown`                      | Evidence is insufficient or no reviewed category fits. Requires a rationale and review flag.                                                                                                                  | unresolved cases only                                                                                                             |


Classification rules:

- Assign exactly one primary organization-domain code and at most two secondary codes to the primary featured organization.
- Classify the organization/unit's durable role, not merely the subject of this video. A talk about evals does not turn OpenAI into an eval company.
- Use the existing `research_engineering_category_code` for the video's technical subject and `research_application_domain` for the application vertical. Do not duplicate those meanings into the organization enum.
- Prefer a narrower code over a general one. `coding_agents_developer_tools` outranks `ai_developer_platform_sdk` when coding is the organization's defining implementation; `frontier_model_lab` remains Anthropic's primary organization domain even when the implementation is Claude Code.
- Use secondary organization domains only for durable, evidenced product lines—not every capability mentioned in the talk.
- `other_unknown` is allowed so the model never forces a false classification, but it always routes the run to review.

Primary-domain tie-breaker, in order:

1. The official mission and defining product of the narrowest featured organization/unit.
2. The role for which that organization/unit is best known and structurally built, using first-party evidence.
3. The implementation directly owned by the unit in this video.
4. If two durable roles remain, select the more specific code as primary and retain the other as secondary with evidence.
5. Never let a one-off talk topic override the organization's durable role.

Expected ambiguous-case outcomes include: LlamaIndex → `retrieval_knowledge_platform` with agent framework as an evidenced secondary when appropriate; LangChain/LangGraph → `agent_framework_orchestration`, with LangSmith supporting an evaluation secondary; Hugging Face → `open_source_ai_ecosystem`, with model platform as a possible secondary; NVIDIA → `ai_compute_hardware_systems`; MongoDB → `database_data_ai_platform`; and Arize/Braintrust/Langfuse → `evaluation_observability_llmops`.

Seed a companion `public.research_organization_domain_definition` lookup keyed by the enum with `label`, `description`, `inclusion_criteria[]`, `exclusion_criteria[]`, `example_organizations[]`, `active`, `sort_order`, and `definition_version`. The enum is the stable database contract; the definition rows are the prompt-facing, reviewable taxonomy loaded by tools.

Add `public.research_organization_scope` enum:

```text
independent_company | parent_company | subsidiary | division | research_lab |
product_organization | standards_body | academic_institution | nonprofit |
community_education_media | other
```

Add `public.research_video_organization_role` enum:

```text
primary_featured_organization | implementation_owner | speaker_employer |
parent_organization | subsidiary_or_division | acquisition_party | partner |
customer_or_internal_user | standards_steward | mentioned_only
```

Create `public.research_organization_candidate` as analysis-scoped staging, not the canonical aiengineerapp organization graph:

```text
organization_candidate_id uuid primary key
analysis_id uuid -> research_video_analysis.analysis_id on delete cascade
video_id text -> research_starter_videos.video_id
canonical_name text not null
normalized_name text not null
organization_scope research_organization_scope not null
relationship_roles research_video_organization_role[] not null
is_primary_featured boolean not null default false
featured_rank integer not null
primary_domain_code research_organization_domain_code not null
secondary_domain_codes research_organization_domain_code[] not null default {}
parent_name text null
parent_canonical_url text null
official_url text not null
authoritative_summary text not null
relationship_to_implementation text not null
current_status text not null
status_as_of date not null
video_time_name text null
video_time_parent_name text null
ownership_changed_since_video boolean not null default false
confidence numeric(4,3) not null
evidence_ids uuid[] not null default {}
generated_at timestamptz not null
unique (analysis_id, normalized_name)
```

Enforce exactly one `is_primary_featured = true` and exactly one `featured_rank = 1` organization per analysis. Panels may contain several fully categorized organizations, but only rank 1 is the primary featured organization; record the ranking rationale rather than creating an ambiguous multi-primary exception.

Create `public.research_organization_source`:

```text
organization_source_id uuid primary key
organization_candidate_id uuid -> research_organization_candidate on delete cascade
source_rank integer not null
source_role text not null
authority_tier text: first_party | official_registry | standards_body | reputable_secondary
title text not null
publisher text not null
url text not null
normalized_url text not null
publicly_retrievable boolean not null
retrieved_at timestamptz not null
source_published_at timestamptz null
supports jsonb not null default []
verification_status research_verification_status not null
is_required_core_source boolean not null default false
evidence_id uuid null -> research_evidence_anchor.evidence_id
unique (organization_candidate_id, normalized_url)
```

Allowed `source_role` values should be contract-enforced: `official_homepage`, `official_about`, `official_product`, `official_documentation`, `official_research`, `official_model_or_system_card`, `official_repository`, `official_engineering_blog`, `official_changelog`, `official_press_release`, `regulatory_or_company_registry`, `standards_specification`, `conference_primary_material`, and `reputable_secondary_context`.

For the primary featured organization require at least two verified, authoritative, publicly retrievable sources:

1. One identity/ownership source: official homepage/about page, registry/filing, or official acquisition/organization announcement.
2. One implementation-specific technical source: official product page, documentation, repository, research/model/system card, engineering blog, changelog, or standards specification directly relevant to the talk.

Prefer three to six high-value sources; do not pad the list. Social profiles, search-result snippets, scraped biographies, unauthenticated directory listings, and unsourced aggregators do not satisfy the authoritative minimum. A reputable secondary source may provide context but cannot replace both required authoritative sources.

Every material sentence in `authoritative_summary`, `relationship_to_implementation`, parent/ownership claims, and current-status claims must cite one or more organization source IDs/evidence IDs. The artifact must render human-usable citations with source title, publisher, canonical URL, source role, and the exact claim supported; a bare URL list is insufficient.

Attribution precedence is mandatory:

1. Identify the implementation actually discussed.
2. Identify the narrowest stable organization/unit that officially owns or builds it.
3. Record that unit as the primary featured organization.
4. Record its parent separately when authoritative evidence supports the relationship.
5. Record speaker employer separately; employment alone does not prove implementation ownership.
6. Preserve both video-time and current ownership/name when an acquisition, rename, spinout, or reorganization occurred.

Examples:

- **GitHub Copilot:** primary organization `GitHub`, parent `Microsoft`, implementation `GitHub Copilot`, organization domain `coding_agents_developer_tools`.
- **Azure AI Agent Service / Azure AI Foundry:** primary organization/unit `Microsoft Azure AI`, parent `Microsoft`, organization domain `cloud_ai_platform`.
- **Claude Code:** primary organization `Anthropic`, implementation `Claude Code`, primary organization domain `frontier_model_lab`; coding-agent classification belongs to the implementation/video and may be a secondary organization domain only if the durable product line justifies it.
- **OpenAI Agents SDK:** primary organization `OpenAI`, implementation `Agents SDK`, organization domain `frontier_model_lab` with `ai_developer_platform_sdk` as an evidenced secondary.
- **Amazon Q Developer:** primary organization `AWS`, parent `Amazon`, implementation `Amazon Q Developer`, organization domain `cloud_ai_platform`.
- **Amazon AGI Lab:** primary organization/unit `Amazon AGI Lab`, parent `Amazon`, organization domain `frontier_model_lab` or `applied_ai_research_lab` based on authoritative mission evidence.
- **Google Gemini/Deep Research/Veo:** prefer `Google DeepMind` when it is the evidenced builder; record the broader Google/Alphabet relationship separately.

### 4.6 Artifact registry

Create `public.research_pre_research_artifact`:

```text
artifact_id uuid primary key
run_id uuid -> research_pre_research_run.run_id on delete cascade
intent_id uuid null -> research_ingestion_intent.intent_id on delete cascade
artifact_kind text
schema_version text
storage_bucket text
storage_path text
content_sha256 text
byte_count bigint
created_at timestamptz
unique (run_id, artifact_kind)
unique (storage_bucket, storage_path)
```

Allow only these twelve v2 artifact kinds: `run_manifest`, `transcript_analysis`, `taxonomy_classification`, `web_context`, `organization_research`, `source_verification`, `curriculum_signals`, `initial_summary`, `technology_library_summary`, `organization_profile`, `ingestion_intent`, and `execution_receipt`. Register artifacts only after a successful storage upload. This prevents the current condition where Postgres advertises an object path that does not exist.

### 4.7 Claim and qualification database functions

Replace the five-argument `research_private.claim_pre_research_video` with an additive six/seven-argument version that includes packet schema version and optionally a specific `video_id`. Preserve grants and include `extensions` in `search_path` for `digest()`.

Both automatic and specific-ID branches must enforce the same predicates:

- `transcript_status = 'stored'`
- non-null, non-blank `transcript_text`
- `transcript_bucket = 'ai-engineer-transcripts'`
- non-null `transcript_path`
- matching `storage.objects(bucket_id, name)` row
- `duration_seconds IS NOT NULL`
- `duration_seconds > 0`
- `duration_seconds < 5400`
- no live or applied run for the current transcript hash
- no finished state for the current transcript hash

Return precise reasons for specific-ID failures: `TRANSCRIPT_NOT_STORED`, `TRANSCRIPT_OBJECT_MISSING`, `DURATION_MISSING`, `DURATION_INVALID`, `VIDEO_TOO_LONG`, and `VIDEO_ALREADY_CLAIMED_OR_FINISHED`.

Automatic claims must use:

```sql
ORDER BY v.published_at ASC NULLS LAST, v.video_id ASC
FOR UPDATE OF v SKIP LOCKED
LIMIT 1
```

Add `research_private.refresh_pre_research_video_qualification(p_video_id text default null)` to upsert the state table from authoritative video and storage data. It should support one video or the whole catalog and return counts by eligibility/reason. The claim RPC must still repeat the predicates; a cached qualification row alone is not a security or correctness boundary.

Add trusted phase-transition functions used by the controller:

- `research_private.begin_research_session(run_id, eve_session_id)`
- `research_private.complete_research_phase(run_id, eve_session_id)`
- `research_private.begin_synthesis_session(run_id, eve_session_id)`
- `research_private.complete_synthesis_phase(run_id, eve_session_id, next_status)`

Each function must lock the run, enforce the legal prior status, verify the current transcript hash, update the current session pointer/state projection, and append/update the session ledger. `complete_research_phase` additionally verifies registered `00`–`50` hashes before setting `research_complete`. `begin_synthesis_session` is the only path into `synthesizing`.

Add a partial/covering index suitable for the eligible ordering, such as `(published_at ASC, video_id ASC)` over rows with stored transcripts and duration under 5400. Storage existence remains a join and cannot be encoded in that partial index.

### 4.8 Downstream handoff view

Create a service-only view or RPC named `research_private.list_finished_pre_research_videos` joining:

- current video metadata
- current finished state
- applied run and intent
- `research_video_analysis`
- contextualized initial summary
- technology summaries
- organization candidates, organization-domain assignments, parent/unit relationships, and ranked authoritative sources

Require `finished_transcript_sha256 = state.transcript_sha256` and order by `published_at ASC NULLS LAST, video_id`. This is the only pre-research feed the paid deep-research, curriculum, and official-ingestion agents should consume initially.

## 5. Contract and intent changes

Update `contracts/enums.ts`:

- `PROMPT_BUNDLE_VERSION = "pre-research-2.0.0"`
- introduce `PACKET_SCHEMA_VERSION = "2.0.0"`
- set the new intent schema version to `2.0.0`
- add the temporal-status enum
- add `researchOrganizationDomainCodeSchema` with every code in `research_organization_domain_code`
- add organization scope, video relationship-role, source-role, and authority-tier schemas
- keep the GLM model literal and existing taxonomy version unchanged

Update `contracts/pre-research-packet.ts`:

- Add `research_as_of` to the run manifest.
- Add `video_published_at` and the date used for web status reasoning where relevant.
- Add `initialSummarySchema` for `60-initial-summary.json`.
- Add `technologyLibrarySummarySchema` for `70-technology-library-summary.json`.
- Add `organizationResearchSchema` for `35-organization-research.json`.
- Add `organizationProfileSchema` for `80-organization-profile.json`.
- Add all four objects to `preResearchPacketSchema`.
- Add cross-file validation: matching `run_id`, `video_id`, transcript hash, research date, and referenced evidence IDs.
- Add organization invariants: exactly one primary/rank-1 featured organization; one primary organization domain per included organization; at most two secondary organization domains; verified parent/unit relationships; and the two-source authoritative minimum for the primary organization.

Update `contracts/ingestion-intent.ts` with four new allowlisted operations:

1. `create_contextualized_initial_summary`
2. `replace_technology_library_summaries`
3. `replace_organization_candidates`
4. `replace_organization_sources`

The v2 operation order becomes:

1. `create_video_analysis`
2. `create_contextualized_initial_summary`
3. `replace_technology_library_summaries`
4. `replace_category_assignments`
5. `replace_domain_assignments`
6. `replace_lifecycle_assignments`
7. `replace_evidence_anchors`
8. `replace_organization_candidates`
9. `replace_organization_sources`
10. `upsert_resource_candidates`
11. `upsert_entity_candidates`
12. `record_web_search_events`

The summary and organization payloads in the intent must be identical in meaning to files `60`, `70`, and `80`. Organization candidate UUIDs are generated in the intent so organization-source operations can reference them deterministically. Compute idempotency from stable canonical JSON, not ordinary `JSON.stringify` property insertion order. Include `research_as_of` in the source envelope and therefore in the idempotency material.

Update `contracts/execution-receipt.ts` for the new operation kinds and add:

- `packet_schema_version`
- `packet_storage_prefix`
- `finished_marker_written`
- `artifact_count`

## 6. Agent logic and prompts

### 6.1 Runtime date injection

Do not hard-code a date in `instructions.md`. At claim time, compute the UTC date and persist it on the run. Include the exact ISO date in:

- `00-run-manifest.json`
- every specialist parent message
- web-search query guidance
- `60`, `70`, and `80`
- the v2 intent source envelope

The root and web specialists should receive this explicit instruction:

> Research as of YYYY-MM-DD. Compare the video's publication date with the current research date. Verify time-sensitive claims with first-party sources when possible. Label technology status as current, changed since publication, historical, or uncertain. Do not assume the transcript describes the present.

“Try your best to reason about current status” must never turn into guessing. If Exa results do not support a current-status conclusion, emit `uncertain` and explain what was not verified.

### 6.2 Existing specialist changes

- `transcript_analyst`: continue producing transcript-only summaries and anchors. Add clearer structured software-engineering and AI concept candidates, but do not make present-day claims.
- `taxonomy_classifier`: unchanged except it receives the date for packet consistency; classification remains transcript/description grounded.
- `web_context_scout`: search official documentation, repositories, changelogs/releases, product pages, and relevant speaker/company context. Searches should include the technology name and the runtime year where useful.
- Add `organization_researcher`: use Exa to identify the implementation, narrowest owning organization/unit, parent relationship, speaker affiliation, current/video-time names and ownership, proposed organization-domain classification, and three to six candidate authoritative sources. Write `35-organization-research.json`. It proposes; it does not declare a source verified. It must record every Exa search through `record_web_search_event`.
- `source_verifier`: verify official ownership, current naming/status, deprecation/renaming, relationship among libraries, organization hierarchy, organization-domain rationale, and every source intended to satisfy the authoritative minimum. Reject a parent/unit/product relationship that is supported only by inference.
- `curriculum_mapper`: continue generating pre-curriculum signals only. It may consume concept candidates but must not create the new summaries.

Extend the web-context, organization-research, and source-verification contracts so verified results carry enough evidence for temporal and organization claims: source URL, page title/publisher, source role, authority tier, public retrievability, verification status, `checked_at`, claim supported, and optional release/status date.

Extend the web-search event subagent enum/constraint to include `organization_researcher`, while keeping provider fixed to `exa`.

### 6.3 Deterministic two-session orchestration

Do not have the research root decide that enough research has occurred and then call another subagent. The application controller—not GLM—owns the phase transition.

Use two new root sessions in the same Eve project for each video:

1. **Research session.** Claims/loads the run, executes five wave-one specialists plus the source verifier, validates outputs `10`–`50` including `35`, uploads the durable research checkpoint, and stops. It must never generate `60`, `70`, `80`, or `90`.
2. **Synthesis session.** Starts only after trusted code confirms `research_complete`. It loads the registered `00`–`50` artifacts from storage, produces `60`, `70`, `80`, and `90`, saves the completed packet, and stops at `intent_ready` or `review_required`.

The synthesis session is a fresh root session, not a follow-up turn in the research session and not a child subagent selected by the research model. This clean boundary prevents the transcript-heavy research history from becoming an implicit input, makes synthesis independently retryable, and forces the summary to derive from durable validated artifacts.

Persist `research_session_id` and `synthesis_session_id` on the run immediately after each `client.sessions.create(...)` call succeeds. A synthesis retry creates a new session only when the prior synthesis session is terminal/failed; record every attempt in `research_pre_research_session` rather than overwriting evidence silently.

Account for the short create-and-bind race: phase tools must refuse work until the current Eve session ID is registered for that run. Treat `SESSION_BINDING_PENDING` as retryable; never let an unbound session proceed merely because its prompt names a valid `run_id`.

Use `eve/client` in the deterministic controller. The controller sequence is:

```ts
const research = await client.sessions.create({
  message: buildResearchPhaseMessage(runId),
  clientContext: { phase: "research", run_id: runId },
});
await persistResearchSessionId(runId, research.response.sessionId);
const researchResult = await research.response.result();

await validateAndCompleteResearchCheckpoint(runId, researchResult);

const synthesis = await client.sessions.create({
  message: buildSynthesisPhaseMessage(runId),
  clientContext: { phase: "synthesis", run_id: runId },
});
await persistSynthesisSessionId(runId, synthesis.response.sessionId);
const synthesisResult = await synthesis.response.result();
```

The exact Eve Client API must match the installed Eve version. `clientContext` is one-turn context, not the authorization boundary. Every phase-specific tool must load the run from Postgres and reject a phase mismatch. The synthesis session may start only when the current transcript hash still matches and the run is `research_complete`.

Use `defineDynamic` at `turn.started` for phase-specific instructions, tools, skills, and pre-authored subagent availability:

- Research phase: expose the five wave-one specialists (including `organization_researcher`), source verifier, Exa search, research artifact writers, and research-checkpoint tool. Set `Workflow` `maxSubagents` to at least 6 for five wave-one calls plus verification.
- Synthesis phase: return `null` for all research subagents; expose only packet loading, summary/intent schema skills, synthesis artifact writing, and completed-packet validation.
- Keep the model static as `zai/glm-5.2` in both phases.
- Treat dynamic capability selection as composition and least privilege, not as authorization. Database phase checks remain mandatory.
- Dynamic local subagents must be authored and compiled in the same deployment. The implementation must not attempt to invent a new filesystem subagent at runtime.

No synthesis subagent is required initially. The clean synthesis root session should generate `60`, `70`, `80`, and `90` itself. Add a pre-authored `post_research_synthesizer` subagent later only if evals show that the root cannot reliably meet the output contracts; even then, the deterministic controller still starts the synthesis root session and owns the phase transition.

### 6.4 Synthesis output requirements

After the synthesis session has loaded and validated `00`–`50`, it produces `60`, `70`, and `80` before producing `90`.

`60-initial-summary.json` is the final post-research summary artifact and must contain:

- a concise transcript summary that faithfully states what the video says
- software-engineering concepts discussed
- AI concepts discussed
- why the concepts matter together
- separately labeled external/contextual notes produced by the research pass
- publication-date versus research-date context, without rewriting historical transcript claims as current facts
- evidence IDs and evidence grades for each substantive claim
- an explicit note when the transcript and current web evidence disagree

`70-technology-library-summary.json` must contain:

- zero, one, or more ranked technology families
- a primary technology for each family
- a clear separation between the technology/method and the libraries, frameworks, SDKs, tools, services, products, protocols, models, and repositories that implement it
- naturally related implementations in the same family
- how each item is used or discussed in the video
- how the items relate to each other
- present status as of `research_as_of`
- official/first-party URLs when verified
- confidence, evidence IDs, and temporal status

If no identifiable main technology/library exists, emit an empty `families` array plus `no_main_technology_reason`; do not force a product into every video.

`80-organization-profile.json` must contain:

- the primary featured organization/unit and exactly one primary organization-domain enum
- up to two evidenced secondary organization domains
- organization scope and relationship roles
- authoritative description of what the organization/unit does in AI engineering
- the featured implementation/product and the organization's relationship to it
- parent organization as a separate object when applicable
- speaker employer as a separate fact when applicable
- video-time and current names/ownership with `research_as_of`
- three to six ranked sources, including the two required verified authoritative/publicly retrievable source roles
- evidence IDs, confidence, unresolved conflicts, and review reasons

If no organization can be identified, emit `other_unknown`, a precise reason, the searches attempted, and `review_required`; do not invent an organization from the speaker's name.

### 6.5 Phase-specific instructions

Keep `agent/instructions.md` short and stable: one project identity, GLM/Exa constraints, schema boundary, evidence rules, and the requirement to obey the current run phase. Add dynamic instructions such as `agent/instructions/phase.ts` that resolve at `turn.started` and load authoritative phase data for the requested run.

The research-session order is:

1. Load the controller-claimed run and require status `claimed` with the matching research session binding.
2. Reconfirm the video remains qualified; stop on a qualification reason.
3. Write manifest with `research_as_of`.
4. Run wave one.
5. Run verifier.
6. Write `10`–`50`.
7. Validate and upload the `00`–`50` research checkpoint.
8. Return a structured research-phase receipt. Do not write `60`, `70`, `80`, or `90`, and do not start another agent.

Trusted controller code then verifies the registered artifact hashes and moves the run from `analyzing` to `research_complete`.

The synthesis-session order is:

1. Load the run by the controller-supplied `run_id` and require `research_complete`.
2. Atomically move the run to `synthesizing` and bind `synthesis_session_id`.
3. Load and hash-verify registered `00`–`50` artifacts from `research-ingestion-intents`.
4. Produce and validate `60`, `70`, and `80` after the research checkpoint.
5. Produce `90` from `10`–`80`.
6. Upload/register `60`, `70`, `80`, and `90` and validate the complete `00`–`90` packet.
7. Mark `intent_ready` or `review_required` and return a structured synthesis receipt.

Neither session may claim the pipeline is finished. Only the deterministic executor/finalizer can set that state.

Update the local schema, filesystem, taxonomy, and ingestion-intent skills/references so an Eve model sees the exact v2 table names, packet paths, operation payloads, and date semantics. Update both copies of the taxonomy skill together.

## 7. Durable packet ingestion

Replace the current intent-only persistence behavior with two phase-specific tools. The separate synthesis session cannot rely on the research session's sandbox, history, or child-session results, so `00`–`50` must be durable before `research_complete`.

`save_research_phase_packet` must:

1. Accept `00`–`50` without raw transcript text.
2. Zod-validate every research artifact and all cross-file run/video/hash/date references.
3. Canonically serialize each artifact and compute SHA-256 and byte count in trusted TypeScript.
4. Write local development and research-session sandbox copies atomically.
5. Upload `00`–`50` to the private Supabase bucket using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in app-side code only.
6. Register artifacts only after upload and return a structured research-phase receipt.
7. Not mark `research_complete` itself. Trusted controller code independently verifies the registry/objects and performs that transition.

`load_research_phase_packet` is synthesis-only. It must require `research_complete` or `synthesizing`, download registered `00`–`50`, verify every hash, parse every contract, and return the bounded artifact contents needed for synthesis. It must not expose service credentials or retrieve an unregistered path supplied by the model.

`save_pre_research_packet` must:

1. Accept `60`, `70`, `80`, and `90` for the already registered run without raw transcript text.
2. Require run status `synthesizing` and matching `synthesis_session_id`.
3. Revalidate the full logical `00`–`90` packet and all evidence references.
4. Canonically serialize, locally persist, upload, and register `60`, `70`, `80`, and `90`.
5. Use upsert only when the existing object's hash matches. Reject a same-path/different-content collision.
6. Insert/update the validated intent ledger only after all required `00`–`90` objects exist.
7. Set `run.intent_path`, `run.intent_sha256`, `packet_storage_prefix`, and manifest hash.
8. Return uploaded paths/hashes and a structured synthesis-phase receipt without exposing secrets or transcript text.

On partial upload, either phase retry must resume by comparing hashes. It must not create a second intent or silently overwrite different data. A failed synthesis session must not invalidate a successfully completed research checkpoint.

## 8. Deterministic executor and table building

Implement `executor/apply-intent.ts`, `executor/operations.ts`, and a non-model CLI such as `scripts/apply-pre-research-intent.mjs` or TypeScript equivalent.

Execution sequence:

1. Identify the validated intent by `intent_id` or run ID.
2. Download `90-ingestion-intent.json` from its recorded bucket path.
3. Verify its SHA-256 against the intent ledger and artifact registry.
4. Parse the correct versioned Zod schema.
5. Verify video, run, taxonomy version, model ID, prompt version, research date, and packet prefix.
6. Re-read the current transcript, verify all eligibility rules, and recompute the transcript hash.
7. Verify every required `00`–`90` artifact exists and matches its registry hash.
8. Refuse automatic application when the run is `review_required`, the organization is `other_unknown`, organization hierarchy conflicts remain, or the primary organization lacks the two required verified authoritative/publicly retrievable sources, unless an explicit reviewed/approved resolution is present. Do not treat low confidence as finished.
9. Take a transaction-scoped Postgres advisory lock on the intent ID.
10. If already applied, reconstruct or load an `already_applied` receipt and continue to finalization idempotently.
11. Set run/state to `applying`.
12. In one transaction, apply only the allowlisted operations in declared order.
13. Create `research_video_analysis` first and pass its ID to all child-table handlers.
14. Create the contextualized initial-summary row from its operation.
15. Delete-and-replace technology-family rows for that analysis from their operation.
16. Apply category, application-domain, and lifecycle assignments.
17. Replace evidence anchors before inserting any source rows that reference them.
18. Delete-and-replace organization candidates and their ranked source rows, preserving intent-supplied UUID references.
19. Apply other resource/entity candidates and search events with operation-level receipts.
20. Mark intent `applied` and run `applied`; commit.
21. Canonically create and upload `99-execution-receipt.json`, then register it.
22. In a small final transaction, set state to `finished` and populate `pre_research_pipeline_finished`, finish timestamp, finished hash, latest run, and intent ID.

If step 21 fails after database commit, leave state as `finalizing`, not `finished`. A retry detects the applied intent, writes/verifies the receipt, and completes step 22. This makes the finish marker truthful without trying to make Postgres and object storage one atomic system.

Handlers must use parameterized SQL and fixed table mappings. Continue rejecting `execute_sql`, unknown operations, unknown columns, and unknown taxonomy codes. Normalize URLs in trusted code and validate that all evidence IDs referenced by summaries/resources/entities exist for the analysis.

## 9. Video pre-qualification and queue behavior

Centralize eligibility in shared SQL/function logic and make every entry point call it. Do not maintain separate, slightly different definitions in the runner and claim function.

Qualification reasons should be cumulative for reporting, but claiming should return the most actionable primary reason. At minimum track:

- `transcript_status_not_stored`
- `transcript_text_empty`
- `transcript_bucket_invalid`
- `transcript_path_missing`
- `transcript_object_missing`
- `duration_missing`
- `duration_non_positive`
- `duration_at_or_over_5400_seconds`
- `already_live_for_current_transcript`
- `already_finished_for_current_transcript`

Update `scripts/eligible-videos.mjs` to select from the qualification/state function or exactly the same canonical SQL. Include `duration_seconds`, transcript hash, eligibility reasons, current pipeline status, and published date in its output.

Update `scripts/list-eligible-videos.mjs`, `scripts/run-pre-research-session.mjs`, `HANDOFF.md`, `README.md`, and `.cursor/skills/run-pre-research/SKILL.md` so:

- all queues are oldest-first by `published_at`
- `--video-id` cannot bypass qualification
- `--all` takes a stable snapshot of qualified IDs and still lets the claim RPC recheck each ID
- failure output distinguishes ineligible, already running, research failed, synthesis failed, review required, finalizing, and finished
- success is not merely an Eve `turn.completed`; it reports the durable run phase (`research_complete`, `synthesizing`, `intent_ready`, `review_required`, `finalizing`, or `finished`)

For production scheduling, keep a single deterministic dispatcher schedule. It must advance persisted work rather than ask one model session to own the whole pipeline:

1. Claim eligible videos and start research sessions.
2. Detect completed research sessions, verify `00`–`50`, and mark `research_complete`.
3. Start synthesis sessions for `research_complete` runs that have no live synthesis session.
4. Detect completed synthesis sessions, verify `60`–`90`, and move to `intent_ready`/`review_required`.
5. Invoke the non-model executor/finalizer for applicable intents.

Start with one video in flight while validating GLM/Exa behavior. After the executor is stable, use a configured per-phase concurrency cap (initially 3 research sessions and a separately bounded synthesis count). The database claim and phase-transition functions remain the concurrency controls. Vercel cron expressions are UTC.

## 10. Downstream ingestion contract

The paid deep-research, curriculum-creation, and official-ingestion agents are consumers, not part of this implementation.

They should consume only the service-only finished feed described above. Give them:

- video metadata and publication date
- transcript pointer and current transcript hash (not unrestricted public transcript access)
- run/intent IDs and bucket prefix
- transcript-only analysis
- contextualized initial summary
- technology/library families and temporal status
- primary featured organization/unit, organization-domain categorization, parent relationship, implementation ownership, and ranked authoritative sources
- taxonomy/domain/lifecycle assignments
- verified resources/entities and evidence anchors
- `research_as_of`

They may correct or enrich starter research, but must retain the pre-research run/intent IDs for provenance. They must not interpret `intent_ready` as finished.

## 11. Exact repository worklist

### Supabase

- Add the v2 migration under `supabase/migrations/`.
- Add a separate backfill migration after code deployment.
- Replace the claim RPC signature safely: drop only the exact prior signature, create the new signature, revoke public/anon/authenticated, grant postgres/service_role.
- Add qualification refresh and finished-feed functions.
- Add organization enums, organization candidate/source tables, constraints, indexes, RLS, and service-role grants.
- Update schema documentation in `agent/skills/pre-research-schema/references/postgres-schema.md` and its sandbox copy.

### Contracts and executor

- `contracts/enums.ts`
- `contracts/pre-research-packet.ts`
- `contracts/ingestion-intent.ts`
- `contracts/execution-receipt.ts`
- `executor/apply-intent.ts`
- `executor/operations.ts`
- `executor/postgres.ts`
- `executor/url-normalization.ts` as needed for canonical official URLs
- add canonical JSON/hash helpers shared by save and apply paths
- add deterministic organization/source URL normalization and authoritative-source invariant validators
- add the executor/finalizer CLI and package scripts

### Eve agent

- `agent/instructions.md`
- `agent/tools/claim_pre_research_video.ts`
- `agent/tools/load_video_context.ts`
- add `agent/tools/save_research_phase_packet.ts`
- add `agent/tools/load_research_phase_packet.ts`
- replace/extend `agent/tools/save_pre_research_intent.ts` as `save_pre_research_packet`
- add phase-aware dynamic instructions under `agent/instructions/`
- make existing research subagents dynamically unavailable during synthesis
- add `agent/subagents/organization_researcher/` with its own instructions and Exa/search-ledger tools
- raise `agent/tools/workflow.ts` to at least six subagent calls per research workflow
- add an organization-taxonomy skill/reference containing the exact enum definitions, precedence rules, source hierarchy, and examples
- `agent/lib/artifact-storage.ts` for local plus Supabase Storage durability
- specialist instructions and Zod-shaped outputs
- schema/filesystem/intent skills and references
- `agent/schedules/process_next_video.ts`

Keep `agent/agent.ts` on GLM 5.2, keep `agent/tools/web_search.ts` on free Exa via Gateway, and keep the generic copy-agent disabled.

### Runner and documentation

- `scripts/eligible-videos.mjs`
- `scripts/list-eligible-videos.mjs`
- `scripts/run-pre-research-session.mjs`
- add a deterministic two-session controller such as `scripts/run-pre-research-pipeline.mjs` using `eve/client`
- persist and reconcile research/synthesis session IDs and structured phase receipts
- `package.json`
- `.env.example` (document Supabase service credentials; never add secrets)
- `README.md`
- `IMPLEMENTATION.md` or replace it with a pointer to this v2 plan once implementation starts
- `HANDOFF.md`
- `.cursor/skills/run-pre-research/SKILL.md`

## 12. Backfill and rollout

1. Apply the additive schema migration.
2. Deploy qualification-aware claim/list code before running another backlog batch.
3. Run qualification refresh for all catalog rows and inspect reason counts.
4. Confirm all eligible rows have `duration_seconds` between 1 and 5399 and a real transcript object.
5. Deploy v2 contracts, phase-specific prompts/capabilities, the two-session controller, phased packet upload, and executor with automatic batch processing disabled.
6. For one smoke video, stop after the research session. Verify `00`–`50`, including `35`, are durable and that no `60`, `70`, `80`, or `90` exists.
7. Start the synthesis session deterministically for that completed research checkpoint. Verify it does not call research subagents and creates only `60`, `70`, `80`, and `90`.
8. Run complete smoke videos representing a single library, a connected library suite, a concept-only talk, GitHub Copilot/Microsoft, AWS/Amazon, Google DeepMind/Google, a multi-company panel, and an AI-adopting non-AI company.
9. Inspect both session IDs, phase receipts, `00`–`99`, DB rows, evidence linkage, temporal labels, and finish state manually.
10. Retry synthesis without rerunning research, then apply each smoke intent twice and prove no duplicate semantic rows are created.
11. Run a 10-video chronological batch sequentially.
12. Build/evaluate a 40–50 video stratified golden set before concurrency 3.
13. Backfill state for old rows conservatively:
  - mark `finished` only when an applied intent, applied analysis rows, current transcript hash match, and durable receipt all exist
    - leave old `intent_ready` rows unfinished
    - either execute valid v1 intents with the v1 executor or supersede and rerun them as v2
14. Enable the production dispatcher and monitor both session phases, GLM, Exa, storage, lease expiry, review rate, and finalization failures.
15. Expose only finished v2 rows to downstream paid agents at first.

## 13. Tests and acceptance gates

### Qualification/database

- A stored non-empty transcript with a real object and duration 5399 is eligible.
- Duration 5400 and 5401 are ineligible.
- Null, zero, or negative duration is ineligible.
- Missing storage object is ineligible even when transcript text is present.
- A specific-ID claim cannot bypass any rule.
- Concurrent claims do not return the same video/hash.
- Automatic claims are in ascending `published_at`, with null dates last and `video_id` as tie-breaker.
- Changing transcript text changes the hash and clears current completion eligibility.

### Agent/contracts

- The runtime UTC date appears consistently in manifest, specialist context, summaries, and intent.
- The research session can create only `00`–`50` and cannot call a synthesis subagent or write `60`, `70`, `80`, or `90`.
- `research_complete` cannot be set until registered `00`–`50` objects exist and match their hashes.
- A synthesis session cannot start for `analyzing`, failed, superseded, or transcript-hash-mismatched runs.
- The synthesis session has a different session ID, loads its input from durable `00`–`50`, and cannot call research subagents.
- `60`, `70`, and `80` cannot be created before the verified research checkpoint is `research_complete`.
- A synthesis failure can be retried without rerunning or rewriting successful research artifacts.
- Spoofing `clientContext.phase = "synthesis"` cannot bypass database phase checks.
- Concepts carry evidence IDs and grades.
- Technology suites can be grouped; unrelated families remain separate.
- A video without a central technology yields an empty family list with a reason.
- Current-status claims without evidence become `uncertain`.
- GitHub Copilot resolves to GitHub as the primary organization and Microsoft as parent; Amazon Q Developer resolves to AWS and Amazon; evidenced Gemini/DeepMind implementations prefer Google DeepMind over the broad parent.
- Organization classification has exactly one primary enum and at most two evidenced secondary enums.
- Video technical categories and organization-domain categories remain independent.
- The primary organization has at least one verified identity/ownership source and one verified implementation-specific technical source, both publicly retrievable.
- A source-result snippet, social profile, or unsourced directory cannot satisfy the authoritative minimum.
- Acquisition/rename fixtures preserve both video-time and current ownership/name.
- `other_unknown`, unresolved hierarchy, or missing authoritative sources produces `review_required` rather than a fabricated organization profile.
- Unknown operation kinds and invalid evidence references fail Zod/cross-file validation.

### Storage/executor

- Every recorded artifact path exists and matches its SHA-256.
- A same-path/different-hash retry is rejected.
- Transcript hash mismatch rejects application.
- Missing required packet artifact rejects application.
- Missing `35` or `80`, invalid organization enum values, broken organization-source UUIDs, or failure of the authoritative-source minimum rejects application or routes to explicit review as specified.
- All table writes derive from the validated intent operations.
- Applying the same intent twice is idempotent.
- Review-required runs do not auto-apply.
- Receipt upload failure leaves `finalizing` and `pre_research_pipeline_finished = false`.
- Retrying finalization uploads/verifies the receipt and sets finished exactly once.
- No operation writes to aiengineerapp learner/entity tables.

### Build/evals

- `npm run typecheck` passes.
- Eve build succeeds for Vercel.
- Add unit tests for contracts, canonical hashing, URL normalization, qualification mapping, operation handlers, and finalization.
- Add integration tests against a disposable Supabase/Postgres environment for claim locking, legal/illegal phase transitions, separate session binding, transaction rollback, idempotency, and storage retry.
- Add Eve evals for summary quality, video-category stability, technology grouping, organization-domain stability, parent/unit/product attribution, temporal ownership reasoning, and hallucinated official resources.

## 14. Operational metrics

Track at least:

- eligible/ineligible counts by reason
- oldest eligible `published_at` and queue age
- claimed, analyzing, intent-ready, review-required, applying, finalizing, finished, and failed counts
- research-session and synthesis-session starts, completions, failures, retries, and orphaned-session counts
- time from research completion to synthesis start, and separate research/synthesis durations
- end-to-end duration and per-stage duration
- GLM input/output use per video
- Exa search count per video and percent with verified first-party sources
- organization-domain distribution, `other_unknown` rate, parent-versus-unit correction rate, and authoritative-source minimum pass rate
- percent of organization sources that are verified, first-party/official, and publicly retrievable
- packet upload and receipt-finalization failures
- transcript-hash mismatch count
- percentage with zero/one/multiple technology families
- human-review rate and category stability on repeated evals

The main success invariant is:

```text
pre_research_pipeline_finished = true
  iff
the current transcript hash has an applied validated intent,
its intent-derived tables exist,
and its complete 00-99 packet is durable and hash-verified.
```

That invariant gives the downstream paid research and ingestion agents a clean, trustworthy handoff while preserving the low-cost GLM 5.2 + Exa pre-research stage at full capacity.