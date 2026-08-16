# Organization-domain enum, precedence, and sources

Postgres enum: `public.research_organization_domain_code`.
Lookup table: `public.research_organization_domain_definition`.

Classify the organization/unit's durable role, not merely the subject of this video. A talk about evals does not turn OpenAI into an eval company.

## Enum

| Enum code | Precise inclusion rule | Catalog-shaped examples |
| --- | --- | --- |
| `frontier_model_lab` | Develops general-purpose frontier/foundation models as a core organizational mission, including the dedicated unit that owns them. | Anthropic, OpenAI, Google DeepMind, Mistral AI, Cohere, Meta Superintelligence Labs, Amazon AGI Lab when it is the evidenced unit |
| `applied_ai_research_lab` | Primarily conducts AI research or translates research into prototypes, but is not best described as a commercial frontier-model provider. | FAIR-like labs, independent applied-research labs |
| `cloud_ai_platform` | Hyperscale or broad cloud organization whose AI services, managed model access, and enterprise platform are the relevant implementation context. | AWS, Microsoft Azure AI |
| `ai_compute_hardware_systems` | Designs accelerators, chips, servers, or tightly coupled AI compute systems. | NVIDIA, Groq, Cerebras, SambaNova, AMD |
| `model_training_inference_platform` | Provides model training, fine-tuning, serving, inference, routing, or elastic AI runtime infrastructure rather than primarily designing chips. | Together AI, Modal, Replicate, Fireworks AI, Anyscale, OpenRouter |
| `ai_data_curation_training_platform` | Provides labeling, curation, synthetic data, data quality, feedback, or training-data infrastructure. | Scale AI, Snorkel |
| `database_data_ai_platform` | General database, warehouse, graph, streaming, or data platform with a material AI engineering product surface. | MongoDB, Supabase, Databricks, Snowflake, Redis, ClickHouse, Neo4j when the database platform is central |
| `retrieval_knowledge_platform` | Primarily builds retrieval, indexing, vector search, RAG, knowledge, or context infrastructure. | LlamaIndex, Pinecone, Weaviate, Qdrant, Voyage AI |
| `agent_framework_orchestration` | Primarily builds agent frameworks, control planes, workflow orchestration, memory, or durable execution for AI agents. | LangChain/LangGraph, agent-framework companies, Prefect when AI orchestration is the evidenced unit/product |
| `ai_developer_platform_sdk` | Provides broad SDKs, gateways, APIs, sandboxes, deployment primitives, or developer platforms for building AI systems, without a narrower category dominating. | Vercel AI SDK/platform, Cloudflare AI developer platform, general AI API platforms |
| `coding_agents_developer_tools` | Builds AI coding agents, IDE/terminal/PR tools, code intelligence, or AI-first software-engineering products. | GitHub, Cursor, Windsurf, Sourcegraph/Amp, Replit |
| `evaluation_observability_llmops` | Primarily builds AI evaluation, tracing, experimentation, observability, monitoring, or reliability products. | Arize, Braintrust, Langfuse, Galileo, Weights & Biases; AI-specific Datadog/Sentry units when evidenced |
| `ai_security_identity_governance` | Primarily builds AI security, authorization, identity, policy, guardrails, red teaming, compliance, or governance systems. | AI-focused WorkOS, Pomerium, security/governance vendors or units |
| `multimodal_voice_media_ai` | Primarily builds voice, speech, audio, image, video, generative-media, or realtime multimodal AI products/platforms. | ElevenLabs, Cartesia, Runway and comparable organizations |
| `robotics_embodied_edge_ai` | Primarily builds robotics, embodied agents, computer-vision/physical systems, or on-device/edge AI platforms. | robotics companies, Roboflow-like vision platforms, dedicated edge-AI units |
| `enterprise_ai_automation` | Primarily sells AI automation, enterprise knowledge work, support, search, productivity, or workflow systems to organizations. | enterprise agent/automation and workplace-AI companies |
| `horizontal_ai_application` | Builds an AI-native end-user application spanning many industries and not better classified as enterprise automation, coding, or media. | general AI assistants/search/productivity applications |
| `vertical_ai_application` | Builds an AI-native product for a specific industry or professional domain. The conventional vertical remains a separate `research_application_domain`. | healthcare, legal, finance, education, or other vertical AI startups |
| `open_source_ai_ecosystem` | Stewardship of open models, libraries, hubs, communities, or distribution is the defining organizational role. | Hugging Face and comparable open AI ecosystems |
| `ai_protocol_standards_body` | Stewards an AI protocol, specification, interoperability standard, or neutral technical governance group. | MCP steering/standards organizations when they—not a vendor—are the featured body |
| `academic_nonprofit_research` | University, academic lab, nonprofit institute, or public-interest research organization. | UC Berkeley labs and comparable institutions |
| `ai_services_consulting` | Primarily provides AI implementation services, consulting, agencies, or systems integration rather than a repeatable AI product/platform. | consultancies and agencies |
| `ai_community_education_media` | Primarily operates AI education, events, media, professional community, or training. | AI Engineer when it is itself the organization being discussed |
| `ai_adopting_product_company` | The featured organization primarily operates a non-AI product/business and the talk explains its internal application of AI. | Booking.com, Pinterest, Uber, Amazon retail/recommendations when no narrower AI unit owns the implementation |
| `general_technology_ai_unit` | A dedicated AI/product unit inside a broad technology company that is real and authoritative but does not fit a narrower value-chain category. Use sparingly. | a formally named Google, Microsoft, Meta, IBM, or Oracle AI unit with broad scope |
| `diversified_technology_company` | Broad technology parent/holding company recorded for hierarchy, where no single AI value-chain role describes the parent as a whole. Do not use when a narrower AI unit is the primary featured organization. | Microsoft, Alphabet/Google, Amazon, Meta, IBM, Oracle when recorded as broad parents |
| `other_unknown` | Evidence is insufficient or no reviewed category fits. Requires a rationale and review flag. | unresolved cases only |

## Classification rules

- Assign exactly one primary organization-domain code and at most two secondary codes to the primary featured organization.
- Classify the organization/unit's durable role, not merely the subject of this video.
- Use `research_engineering_category_code` for the video's technical subject and `research_application_domain` for the application vertical.
- Prefer a narrower code over a general one. `coding_agents_developer_tools` outranks `ai_developer_platform_sdk` when coding is the organization's defining implementation; `frontier_model_lab` remains Anthropic's primary organization domain even when the implementation is Claude Code.
- Use secondary organization domains only for durable, evidenced product lines—not every capability mentioned in the talk.
- `other_unknown` always routes the run to review.

## Primary-domain tie-breaker

1. The official mission and defining product of the narrowest featured organization/unit.
2. The role for which that organization/unit is best known and structurally built, using first-party evidence.
3. The implementation directly owned by the unit in this video.
4. If two durable roles remain, select the more specific code as primary and retain the other as secondary with evidence.
5. Never let a one-off talk topic override the organization's durable role.

Expected ambiguous-case outcomes: LlamaIndex → `retrieval_knowledge_platform` with agent framework as an evidenced secondary when appropriate; LangChain/LangGraph → `agent_framework_orchestration`, with LangSmith supporting an evaluation secondary; Hugging Face → `open_source_ai_ecosystem`, with model platform as a possible secondary; NVIDIA → `ai_compute_hardware_systems`; MongoDB → `database_data_ai_platform`; Arize/Braintrust/Langfuse → `evaluation_observability_llmops`.

## Attribution precedence

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

## Source hierarchy

Allowed `source_role` values: `official_homepage`, `official_about`, `official_product`, `official_documentation`, `official_research`, `official_model_or_system_card`, `official_repository`, `official_engineering_blog`, `official_changelog`, `official_press_release`, `regulatory_or_company_registry`, `standards_specification`, `conference_primary_material`, `reputable_secondary_context`.

Authority tiers: `first_party`, `official_registry`, `standards_body`, `reputable_secondary`.

For the primary featured organization require at least two verified, authoritative, publicly retrievable sources:

1. One identity/ownership source: official homepage/about page, registry/filing, or official acquisition/organization announcement.
2. One implementation-specific technical source: official product page, documentation, repository, research/model/system card, engineering blog, changelog, or standards specification directly relevant to the talk.

Prefer three to six high-value sources; do not pad the list. Social profiles, search-result snippets, scraped biographies, unauthenticated directory listings, and unsourced aggregators do not satisfy the authoritative minimum. A reputable secondary source may provide context but cannot replace both required authoritative sources.

`organization_researcher` proposes sources. `source_verifier` declares verification. Reject a parent/unit/product relationship supported only by inference.
