# Modern AI engineering taxonomy expansion (2026)

**Status:** research proposal  
**As of:** 2026-08-22  
**Scope:** entity categorization for discovery, ranking, deep-research selection, and curriculum/challenge compilation  
**Compatibility target:** retain the existing `research_engineering_category_code` 17-category spine as the stable topical axis

## 1. Executive decision

Do not replace the 17-category engineering spine with one enormous tree. The contemporary AI ecosystem is polyhierarchical: an OpenAI Agents SDK repository can simultaneously be an SDK, a repository, an agent harness, an orchestration implementation, a tool-integration surface, a teaching reference, an actively maintained project, and a security-relevant execution substrate. A single `category` field cannot represent those truths without becoming unstable or misleading.

Use a **faceted, versioned ontology**:

1. Keep the 17-category spine as the stable answer to **“what engineering concern is this primarily about?”**
2. Give every record one canonical entity kind plus one or more reviewed subtypes.
3. Classify architecture, capability, lifecycle, maturity, modality, deployment, governance, evidence, temporal state, and curriculum role on independent axes.
4. Represent ownership, implementation, authorship, dependency, evaluation, and learning structure as temporal, evidence-backed relations—not denormalized labels.
5. Let agents propose new leaf terms and aliases as data. Promote them only through a reviewed ontology release.

This structure reflects current primary-source language. Anthropic distinguishes predefined **workflows** from model-directed **agents**, then identifies prompt chaining, routing, parallelization, orchestrator-workers, and evaluator-optimizer as composable patterns. OpenAI separates single-agent from multi-agent orchestration and describes data, action, and orchestration tools. MCP separates hosts, clients, servers and the primitives tools, resources, and prompts. A2A addresses agent-to-agent capability discovery and task/artifact exchange rather than tool access. NIST organizes risk work around Govern, Map, Measure, and Manage. These are complementary axes, not rival top-level taxonomies.

## 2. Design principles

### 2.1 Classify purpose, form, and state separately

- **Purpose/topic:** the 17-category spine.
- **Form/identity:** person, organization, product, package, repository, paper, talk, model, protocol, dataset, benchmark, and so on.
- **Mechanism:** architectural and capability facets.
- **State:** lifecycle, maturity, maintenance, release, and temporal status.
- **Context:** modality, deployment, application domain, audience, and governance exposure.
- **Pedagogy:** curriculum and assessment roles.

### 2.2 Prefer facets over compound labels

Do not create a leaf such as `production_multi_agent_voice_rag_framework`. Store:

```text
entity_kind=software_product
product_subtype=agent_framework
engineering_primary=agent_architecture_harnesses
coordination_topology=supervisor_workers
capability=[retrieval, tool_use, persistent_memory]
modality=[audio, text]
maturity=production_proven
```

Facets remain queryable and can be recombined for later views.

### 2.3 Separate observed fact, assertion, and inference

Every classification assignment needs `evidence_ids`, `confidence`, `method`, `observed_at`, and `ontology_version`. A GitHub archive flag is an observed fact. “Production-proven” is an assertion requiring deployment evidence. “Foundational curriculum resource” is a downstream editorial judgment. They must not share one unqualified field.

### 2.4 Preserve time

Organizations change ownership, products graduate or disappear, engineers change employers, packages move namespaces, papers gain corrections, protocols change status, and repositories are archived. Relations and classifications therefore need `valid_from`, `valid_to`, `observed_at`, and optionally `superseded_by_assertion_id`.

## 3. Entity-kind system

Use stable root kinds. Leaf subtypes are versioned ontology rows and may be multi-valued where an entity genuinely spans forms.

### 3.1 Person (`person`)

Suggested subtypes/roles:

- research scientist; research engineer; ML/AI engineer; inference/systems engineer; data engineer;
- agent/application engineer; developer-tools engineer; security/safety engineer; product/design leader;
- founder/executive; technical educator; independent maintainer; standards contributor; investor/analyst;
- paper author; repository creator; maintainer; core contributor; speaker; inventor; evaluator/reviewer.

Do not reduce people to job titles. Store **roles as relations with time and evidence**: `WORKS_AT`, `MAINTAINS`, `AUTHORED`, `CONTRIBUTED_TO`, `SPOKE_AT`, `LEADS`, `CREATED`, `ADVISES`. For scholarly work, CRediT contributor roles are useful optional leaves (conceptualization, methodology, software, validation, data curation, writing, supervision, and others) rather than assuming author order describes contribution.

### 3.2 Organization (`organization`)

Retain the existing organization-domain taxonomy and organization scopes. Add orthogonal facets:

- **legal/structural form:** company, subsidiary, division, research lab, academic institution, nonprofit, standards body, open-source foundation, community, media/education organization, government unit;
- **value-chain role:** model creator, compute provider, training/inference platform, data provider, framework/runtime vendor, developer-tool vendor, evaluation/observability vendor, security/governance vendor, application vendor, adopter/operator, integrator/consultancy, publisher/community;
- **business/open status:** commercial proprietary, open-core, foundation-stewarded, community-led, academic, public-sector;
- **operating stage:** emerging, growth, established, acquired, merged, inactive;
- **AI relationship:** AI-native, AI-platform unit, AI-enabled product line, adopter/internal operator.

Organization identity and product identity must stay separate. Anthropic is an organization; Claude Code is a product; the Claude Agent SDK is an implementation/package family; their repositories and documentation are source artifacts.

### 3.3 Software product or managed service (`software_product`)

Subtypes:

- model/API product; agent product; coding agent; research agent; computer-use agent;
- agent builder/framework product; orchestration/control plane; workflow automation product;
- AI gateway/model router; inference service; vector/search/knowledge service; memory service;
- evaluation/benchmarking platform; observability platform; security/guardrail/identity product;
- data/labeling/synthetic-data product; multimodal/voice/media product;
- IDE/editor/CLI developer tool; sandbox/execution environment; cloud AI platform;
- horizontal application; vertical application; embedded AI feature.

Store delivery form separately: hosted SaaS, API, desktop, mobile, browser extension, IDE extension, CLI, appliance, embedded library, or hybrid.

### 3.4 Library/package/framework/SDK (`software_component`)

Subtypes:

- language library; framework; SDK/client; plugin/extension; adapter/integration;
- agent harness; workflow/orchestration library; prompt/programming library;
- retrieval/indexing library; memory/context library; model-serving/runtime library;
- evaluation library; tracing/telemetry instrumentation; guardrail/security library;
- protocol implementation; UI/component library; data-processing library;
- command-line tool; build/deployment tool; reference implementation.

Package identity is not repository identity. One repository can publish many packages; one package can move repositories; a product can contain multiple packages.

### 3.5 Repository (`repository`)

Subtypes:

- canonical source; monorepo; mirror; fork; template/starter; examples/cookbook;
- benchmark/evaluation harness; dataset repository; documentation repository;
- specification repository; research artifact; plugin/connector collection; archived legacy implementation.

Repository classifications should include host, owner namespace, default branch, license evidence, languages, release mechanism, package outputs, docs surface, examples/tests, CI, security posture, governance, contribution model, archive status, and upstream relation. Stars describe attention to a repository, not the quality or adoption of the underlying product.

### 3.6 Paper/research output (`paper`)

Subtypes:

- peer-reviewed article; conference paper; workshop paper; journal article;
- preprint; technical report; whitepaper; system/model card; benchmark paper;
- survey/review; position/opinion paper; replication/reproduction study;
- negative result; dataset paper; demo paper; thesis; standard-related research.

Facets include publication status, venue/type, review status, version, correction/retraction status, empirical/theoretical/system nature, artifact availability, code/data linkage, evaluation scale, reproducibility evidence, and claim type. Citation count is influence evidence, not correctness evidence.

### 3.7 Talk, video, report, and media artifact (`media_artifact`)

Subtypes:

- conference talk; keynote; tutorial; workshop; demo; panel; interview; podcast;
- webinar; livestream; course lecture; engineering report; market report; incident report;
- blog/article; release announcement; documentation guide; slide deck; poster.

Add `content_form`, audience, assumed prerequisites, depth, technical density, evidence level, transcript availability, code/demo presence, commercial bias, event/series, speakers, referenced artifacts, and temporal scope. A talk can be an excellent discovery seed without being authoritative implementation evidence.

### 3.8 Additional roots required by the discovery graph

The current entity schema should expand beyond the seven headline entities so downstream research does not encode these as `other`:

- `model` (foundation, reasoning, embedding, reranker, speech, vision, multimodal, small/on-device, safety/moderation, domain-specialized);
- `protocol_or_standard` (tool/context, agent-to-agent, inference/API, telemetry, identity/auth, model/package format, safety/governance);
- `dataset`, `benchmark`, `evaluation_task`, `environment`, `tool_or_connector`;
- `concept`, `technique`, `architecture_pattern`, `failure_mode`, `security_threat`;
- `release`, `package`, `documentation_set`, `event`, `course`, `curriculum_unit`, `challenge`, `project_blueprint`.

These roots prevent false identity merges such as treating MCP (protocol) as merely a library or SWE-bench (benchmark) as merely a repository.

## 4. The 17-category spine, expanded for 2026

The codes remain stable. The terms below are governed children/tags, not new enum values.

| Stable category | Modern child concepts and boundaries |
| --- | --- |
| `model_foundations_behavior` | transformer and alternative architectures; tokenization; scaling; long-context behavior; reasoning behavior; sampling/decoding behavior; model intrinsic capabilities and limitations. Excludes serving optimization and post-training recipes. |
| `inference_model_systems` | serving engines; batching/scheduling; KV-cache management; speculative decoding; quantization; distillation for serving; model routing; structured/constrained decoding; inference hardware optimization; local/edge inference; latency/cost engineering. |
| `ai_data_engineering` | acquisition, licensing and provenance; labeling/annotation; multimodal data pipelines; filtering/deduplication; synthetic data; preference/feedback data; contamination detection; data quality and governance. |
| `post_training_continual_learning` | SFT; preference optimization; RLHF/RLAIF; reasoning and agent RL; adapters/LoRA; continual/online learning; distillation; reward and verifier design; model editing. Keep runtime prompt adaptation under prompting/context. |
| `prompting_llm_programming` | instruction/prompt design; few-shot examples; structured outputs; schema-constrained generation; prompt/program composition; prompt optimization; reasoning scaffolds; model-facing instructions. Persistent state belongs under context/memory. |
| `context_engineering_memory` | context selection/assembly; compaction/summarization; working/episodic/semantic/procedural memory; session/user/project memory; state stores; cache and context budgeting; memory write/read policy; forgetting; context isolation. Retrieval infrastructure remains category 7. |
| `retrieval_search_knowledge` | embeddings and reranking; lexical/vector/hybrid search; RAG; agentic retrieval; GraphRAG/knowledge graphs; query planning; web/deep research; document ingestion/chunking; citations and grounded generation; retrieval authorization. Generic training data pipelines remain category 3. |
| `agent_architecture_harnesses` | augmented LLM loops; ReAct-like tool loops; plan-and-execute; reflection/self-critique; single-agent and multi-agent systems; supervisors, handoffs, swarms, blackboard/shared-workspace patterns; environment feedback; autonomy and stopping. Durable execution infrastructure remains category 10. |
| `tools_protocols_integrations` | function/tool calling; tool design; MCP clients/servers/hosts and primitives; A2A-style agent interoperability; connectors/plugins; APIs; computer/browser/desktop use interfaces; agent cards/capability discovery; tool permission contracts. |
| `orchestration_durable_execution` | deterministic workflows; prompt chains; routers; parallel map/reduce; queues; schedulers; checkpoints; retries; idempotency; event-driven execution; long-running jobs; workflow state machines; human approval gates; compensation/recovery. |
| `coding_agents_software_engineering` | completion/chat; repository understanding; issue-to-PR agents; test/debug/review/security agents; terminal/IDE/CI agents; software-development environments; code benchmarks; agent-generated changes and verification. Generic computer use stays category 9 or 15 depending focus. |
| `evaluation_testing_benchmarking` | model/component/system/agent evals; capability and regression evals; trajectory/trace evaluation; LLM-as-judge and human evaluation; benchmarks/environments; simulation; online experiments; red teaming; statistical methodology; contamination; evaluator calibration. |
| `observability_reliability_llmops` | traces/spans/events; GenAI semantic conventions; prompt/model/version lineage; cost/token/latency; SLOs; incident response; drift; routing/fallbacks; caching; capacity; quality monitoring; release/canary operations. Offline eval design remains category 12. |
| `security_safety_identity_governance` | prompt/tool/indirect injection; data leakage; memory/context poisoning; identity/authorization; least privilege; excessive agency; supply chain; sandboxing; secrets; audit; policy/compliance; misuse/abuse; model and agent safety; governance and accountability. |
| `multimodal_realtime_systems` | speech/audio/voice; vision/image/video; document understanding; realtime/streaming interaction; spatial/robotics perception; multimodal generation; turn-taking, interruption, synchronization, and media pipelines. |
| `ai_product_ux_human_factors` | interaction design; trust/calibration; uncertainty; explainability surfaces; human-in/on/over-the-loop control; approvals and escalation; accessibility; personalization; collaboration; adoption; failure recovery; disclosure and consent. |
| `ai_platforms_developer_tooling` | model/agent development platforms; gateways; unified SDKs; sandboxes; registries; playgrounds; deployment/control planes; low/no-code builders; artifact/config management; developer experience across the lifecycle. |

### Primary-category tie-break rule

Select the category that best describes the **main engineering decision or failure mode** evidenced in the source, not the brand of tool used. Allow up to three secondaries. Record an alternative only when confidence between the two leading candidates is close. Product/repository entity facets never override the source’s actual technical focus.

## 5. Architecture and capability facets

### 5.1 Control regime

```text
deterministic_software
single_model_call
augmented_model_call
predefined_llm_workflow
model_directed_agent
hybrid_workflow_agent
multi_agent_system
human_agent_team
```

The `predefined_llm_workflow` versus `model_directed_agent` distinction should be mandatory for agentic-system claims. It follows Anthropic’s useful operational boundary: predefined code paths versus model-directed process/tool choice.

### 5.2 Workflow/agent pattern

- prompt chaining; routing; parallel sectioning; parallel voting/ensemble;
- orchestrator-workers; evaluator-optimizer; plan-and-execute; tool-use loop;
- reflection/critique; retrieval loop; event-driven workflow; approval-gated workflow;
- deterministic state machine; blackboard/shared workspace; market/auction; debate;
- simulation; background/ambient agent; agent-as-tool; agent handoff.

Patterns may be combined. `pattern` should never imply maturity or performance.

### 5.3 Coordination topology

```text
single
manager_workers
hierarchical
peer_to_peer
decentralized_handoffs
pipeline_of_specialists
shared_blackboard
dynamic_spawn_join
human_supervised_team
```

### 5.4 Capability layer

- perception/input understanding;
- reasoning/decision; planning/decomposition; generation;
- retrieval/knowledge grounding; memory/state; learning/adaptation;
- tool selection; read action; write/mutating action; code execution; computer use;
- communication/collaboration; delegation; reflection/self-evaluation;
- verification; guardrails/policy; identity/permission; human escalation;
- tracing/observability; durable recovery; scheduling; artifact production.

For each capability store `native`, `integrated`, `extension`, or `claimed_only`, plus evidence and evaluation status.

### 5.5 Tool and interoperability facets

Use OpenAI’s high-level tool purpose classes—`data`, `action`, `orchestration`—and add `execution` and `oversight`. Independently store access mode: native function call, REST/RPC, MCP, A2A, CLI, browser/computer use, database, message bus, plugin, or proprietary connector.

MCP and A2A should not be collapsed:

- **MCP:** model/application context and tool integration; host-client-server architecture; tools, resources, and prompts.
- **A2A:** collaboration between potentially opaque agents; capability discovery/agent cards; messages, tasks, status, and artifacts.

### 5.6 Memory facet

Classify along two axes:

- **semantic role:** working, episodic, semantic, procedural, user/profile, project, social/shared, audit/trajectory;
- **implementation:** context window, rolling summary, key-value/relational store, vector store, graph store, file/artifact store, event log, learned parameters.

Also store persistence scope (turn/session/user/project/global), write policy (automatic/model-directed/deterministic/human-approved), retention, deletion capability, provenance, and poisoning isolation.

### 5.7 Evaluation target

```text
model_call | prompt | retrieval | tool | component | workflow | agent_policy |
trajectory | final_output | end_to_end_task | human_outcome | safety_control |
operational_system
```

Evaluation method is separate: deterministic assertion, unit/integration/E2E test, benchmark, simulator/environment, human rubric, pairwise preference, model judge, trace grader, red team, online A/B, incident analysis. This prevents “has evals” from being treated as one homogeneous property.

## 6. Lifecycle, maturity, and health

Do not use one maturity ladder to summarize everything. Track four dimensions.

### 6.1 Research-to-operations lifecycle (multi-select)

Retain the existing values: `research`, `design`, `implementation`, `evaluation`, `deployment`, `operations`, `governance`. Add leaf activities beneath them, not new enum roots: problem framing, data preparation, prototyping, integration, validation, release, rollout, monitoring, incident response, deprecation, audit.

### 6.2 Artifact release maturity

```text
concept
research_artifact
experimental_prototype
developer_preview
alpha
beta
release_candidate
generally_available
long_term_support
deprecated
end_of_life
archived
unknown
```

Use official release status when available; do not infer GA from stars or package age.

### 6.3 Evidence of operational maturity

```text
no_external_evidence
demo_only
controlled_pilot
named_case_study
production_claim_first_party
production_verified_independent
production_at_scale_evidenced
```

Store deployment count/scale evidence separately. A mature codebase and production adoption are related but not identical.

### 6.4 Project/community health

Facets include release recency and cadence, issue/PR responsiveness, maintainer concentration, bus factor proxy, contributor retention, governance documentation, roadmap, semantic versioning, backwards compatibility, tests/CI, security policy, signed releases/provenance, vulnerability handling, OpenSSF Scorecard controls, documentation/examples, dependency freshness, funding/stewardship, and archive/deprecation signals.

Never turn these directly into an absolute quality label. Use them as transparent feature vectors with observation dates.

## 7. Modality and interaction taxonomy

### Input/output modality (multi-select)

`text`, `code`, `structured_data`, `document`, `image`, `audio`, `speech`, `music`, `video`, `screen`, `GUI_events`, `sensor`, `spatial_3d`, `robot_action`, `API_event`.

### Temporal interaction

`batch`, `request_response`, `streaming`, `realtime_duplex`, `asynchronous_background`, `scheduled`, `event_driven`, `long_running`, `ambient_continuous`.

### User interaction

`no_direct_user`, `chat`, `voice`, `canvas`, `IDE`, `terminal`, `browser`, `desktop`, `mobile`, `API`, `embedded`, `robotic_physical`.

Keep modality distinct from application domain. Voice is a modality; customer support is a domain.

## 8. Deployment and execution taxonomy

### Location/topology

`browser`, `mobile_device`, `desktop_local`, `edge_device`, `robot`, `on_premises`, `private_cloud`, `public_cloud`, `vendor_managed`, `hybrid`, `air_gapped`.

### Runtime isolation

`in_process`, `container`, `microVM`, `sandbox`, `serverless`, `durable_workflow`, `managed_agent_runtime`, `user_device`, `unisolated_unknown`.

### Service and tenancy

- single-user, team, enterprise; single-tenant, multi-tenant, dedicated;
- self-hosted, managed, open-core hosted, proprietary hosted, embedded;
- stateless, session-stateful, durable-stateful;
- synchronous, queued, scheduled, event-triggered, continuously running.

### Model/data placement

Store model execution location, data residency, retrieval-store location, control-plane location, and telemetry destination independently. “Self-hosted framework” does not imply local models or private telemetry.

## 9. Governance, safety, and risk facets

Use NIST AI RMF’s `GOVERN`, `MAP`, `MEASURE`, and `MANAGE` as process facets. Use concrete system exposure facets for discovery and ranking.

### 9.1 Autonomy and consequence

- **decision autonomy:** advisory, drafts-for-review, approval-required, bounded autonomous, open-ended autonomous;
- **action reversibility:** read-only, reversible write, recoverable transaction, hard-to-reverse, irreversible/physical;
- **impact scope:** personal, team, organization, public/customer, critical infrastructure/physical;
- **permission scope:** none, user-delegated, scoped service role, broad service role, administrative;
- **human oversight:** in-the-loop, on-the-loop, over-the-loop/audit, exception-only, none/unknown.

### 9.2 Data and identity exposure

Public, internal, confidential, personal data, sensitive personal data, regulated, secrets/credentials. Add tenant isolation, identity binding, authorization checks, delegation chain, consent, retention/deletion, provenance, and auditability.

### 9.3 Agentic threat tags

Align leaf threats with the OWASP Top 10 for Agentic Applications (2026) and keep them versioned: agent goal hijack, tool misuse, identity/privilege abuse, agentic supply-chain vulnerabilities, unexpected code execution, memory/context poisoning, insecure inter-agent communication, cascading failures, human-agent trust exploitation, and rogue agents. Also preserve conventional prompt injection, data exfiltration, insecure output handling, denial-of-wallet/resource exhaustion, and model/provider supply-chain risks.

Threat exposure and implemented control are separate assignments. A sandboxed code-execution product still has `unexpected_code_execution` exposure while also having isolation controls.

### 9.4 Governance evidence

Track system/model cards; impact/risk assessments; data documentation; evaluation reports; incident disclosure; acceptable-use policy; security policy; threat model; access-control design; audit logs; red-team evidence; regulatory mapping; change control; rollback; user disclosure; recourse. “Has policy page” is not equivalent to “control effectiveness measured.”

## 10. Curriculum taxonomy

Curriculum roles are many-to-many editorial assertions grounded in evidence.

### 10.1 Learning-resource role

```text
orientation
foundational_concept
prerequisite
core_technique
architecture_pattern
reference_implementation
worked_example
tool_practice
lab_platform
case_study
production_case_study
failure_case
anti_pattern
tradeoff_comparison
security_case
benchmark_or_eval_reference
optional_extension
frontier_update
historical_context
```

### 10.2 Assessment/challenge role

```text
diagnostic
knowledge_check
guided_lab
implementation_exercise
debugging_exercise
evaluation_design
red_team_exercise
incident_response_simulation
comparative_experiment
open_ended_challenge
capstone_component
capstone
```

### 10.3 Learning level and cognitive demand

Retain introductory/intermediate/advanced/expert, but add task demand: recognize, explain, apply, analyze, evaluate, design, build, operate, govern. Difficulty must be audience-relative and include explicit prerequisites.

### 10.4 Capability outcome

Outcomes should use observable verbs and link to engineering categories and lifecycle stages, for example:

- design a bounded tool contract;
- implement a durable agent workflow with retries and idempotency;
- evaluate retrieval and end-to-end task success separately;
- threat-model an MCP-enabled agent and enforce least privilege;
- compare single-agent and manager-worker architectures under cost/quality constraints.

### 10.5 Curriculum relations

Use `PREREQUISITE_FOR`, `TEACHES`, `DEMONSTRATES`, `PRACTICES`, `ASSESSES`, `MISCONCEPTION_OF`, `COUNTEREXAMPLE_TO`, `ALTERNATIVE_TO`, `BUILDS_TOWARD`, and `REFRESHES`. Prerequisites form a reviewed directed acyclic graph at the published curriculum-version level; detected cycles become editorial review tasks.

## 11. Cross-entity relationship vocabulary

Relations are assertions with evidence, direction, temporal validity, and cardinality guidance.

### Identity and structure

- `ALIAS_OF`, `VERSION_OF`, `RELEASE_OF`, `FORK_OF`, `MIRROR_OF`, `SUPERSEDES`, `DERIVED_FROM`;
- `PART_OF`, `SUBSIDIARY_OF`, `OWNED_BY`, `ACQUIRED_BY`, `STEWARDED_BY`;
- `PUBLISHED_AS_PACKAGE`, `SOURCE_REPOSITORY_FOR`, `DOCUMENTS`, `EXAMPLE_OF`.

### People and organizations

- `WORKS_AT`, `LEADS`, `FOUNDED`, `MAINTAINS`, `CREATED`, `CONTRIBUTED_TO`, `AUTHORED`, `REVIEWED`, `PRESENTED`, `ADVISES`.

### Technical composition and interoperability

- `DEPENDS_ON`, `OPTIONALLY_DEPENDS_ON`, `IMPLEMENTS`, `WRAPS`, `EXTENDS`, `INTEGRATES_WITH`, `COMPATIBLE_WITH`, `EXPOSES`, `CONSUMES`, `PRODUCES`, `DEPLOYS`, `HOSTS`, `USES_MODEL`, `USES_DATASET`, `USES_PROTOCOL`, `CALLS_TOOL`.

### Research and evidence

- `INTRODUCED_IN`, `DISCUSSED_IN`, `CITES`, `REPLICATES`, `CONTRADICTS`, `SUPPORTS_CLAIM`, `EVALUATED_BY`, `BENCHMARKS`, `TRAINED_ON`, `HAS_ARTIFACT`, `HAS_CORRECTION`, `RETRACTS`.

### Market and choice

- `ALTERNATIVE_TO` (symmetric), `COMPLEMENTS` (symmetric), `COMPETES_WITH` (symmetric and time-bounded), `RECOMMENDED_FOR`, `CONTRAINDICATED_FOR`, `MIGRATES_TO`, `REPLACES`.

### Semantics rules

- Never materialize a symmetric relation in only one query direction; canonicalize pair ordering or project both directions.
- `DEPENDS_ON` requires a version/range when known.
- `COMPATIBLE_WITH` names the tested versions and evidence.
- `OWNED_BY` and employment relations are time-bounded.
- `IMPLEMENTS` is not `INTEGRATES_WITH`; implementation asserts conformance to a design/protocol.
- `CITES` is bibliographic; `SUPPORTS_CLAIM` requires an evidence anchor.
- `POPULAR_WITH` or social co-mention must never substitute for a technical relation.

## 12. Machine-readable assignment contract

Recommended normalized envelope:

```json
{
  "entity_id": "ent_...",
  "canonical_kind": "software_component",
  "subtype_assignments": [
    {
      "term": "agent_framework",
      "confidence": 0.95,
      "evidence_ids": ["ev_..."],
      "method": "verified_external"
    }
  ],
  "engineering": {
    "primary": "agent_architecture_harnesses",
    "secondary": ["tools_protocols_integrations", "orchestration_durable_execution"]
  },
  "facets": {
    "control_regime": ["hybrid_workflow_agent"],
    "patterns": ["orchestrator_workers", "agent_handoff"],
    "capabilities": ["tool_selection", "delegation", "tracing"],
    "modalities": ["text", "structured_data"],
    "deployment": ["in_process", "vendor_managed"],
    "maturity": ["generally_available"]
  },
  "curriculum_roles": ["reference_implementation", "tool_practice"],
  "observed_at": "2026-08-22T00:00:00Z",
  "valid_from": null,
  "valid_to": null,
  "ontology_version": "ai-engineering-2.0.0-draft"
}
```

Implementation rules:

- Controlled values are ontology term IDs, not arbitrary strings.
- Store assignments in rows, not a single JSON blob, even if JSON is the interchange format.
- Every nontrivial assignment has evidence and confidence.
- One primary engineering category; zero to three secondaries.
- Subtypes and facets are multi-valued only where definitions permit.
- `unknown`, `not_applicable`, and `not_observed` are distinct states.
- Negative evidence is a first-class assertion, not absence of a row.
- Rank features read immutable classification snapshots so taxonomy changes do not silently rewrite historical rankings.

## 13. Worked examples

| Entity | Kind/subtype | 17-spine placement | Key facets | Curriculum use |
| --- | --- | --- | --- | --- |
| Anthropic’s “Building effective agents” | media artifact / engineering article | primary `agent_architecture_harnesses`; secondary `orchestration_durable_execution` | workflow-vs-agent boundary; chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer | orientation, architecture pattern, trade-off comparison |
| OpenAI Agents SDK | software component / agent SDK | primary `agent_architecture_harnesses`; secondary tools + orchestration | single/multi-agent, manager and handoff patterns, tools, guardrails, tracing | reference implementation, guided lab |
| Model Context Protocol | protocol/standard / context-and-tool interoperability | primary `tools_protocols_integrations` | host-client-server; tools/resources/prompts; versioned specification | foundational protocol, tool-contract lab, security exercise |
| Agent2Agent (A2A) | protocol/standard / agent interoperability | primary `tools_protocols_integrations`; secondary agent architecture | agent capability discovery; task/message/artifact exchange; cross-framework collaboration | protocol comparison, multi-agent integration challenge |
| SWE-bench | benchmark + dataset + repository-linked artifact | primary `coding_agents_software_engineering`; secondary evaluation | end-to-end issue resolution; environment/test-based scoring | benchmark reference, evaluation-design exercise |
| LangGraph repository | repository / canonical source; software component / orchestration framework as separate entity | primary agent architecture; secondary durable execution | graph/state-machine orchestration, state, checkpoints; repo health observed separately | tool practice, architecture lab, production trade-off case |
| An engineer maintaining an agent runtime | person with time-bounded maintainer and employment relations | no inherent primary engineering category at identity level; derive expertise profile from evidenced work | contributor roles, recency, breadth, artifact impact | potential expert source, not automatically a curriculum authority |

## 14. Discovery and ranking implications

Taxonomy should produce features, never a hidden universal quality score.

- Compare within meaningful cohorts: papers with papers, packages with packages, and products with products before cross-entity portfolio selection.
- Use topical/category assignments for relevance and coverage.
- Use maturity and maintenance facets for readiness.
- Use evidence/governance facets for trust and risk.
- Use relations for dependency centrality, lineage, and influence.
- Use modality/deployment facets for project fit.
- Use curriculum roles/prerequisites for pedagogical value.
- Preserve popularity, citation, download, follower, and social signals in a separate attention/adoption feature family. They must not change claim authority.
- Penalize missing critical evidence rather than treating missing values as zero quality.
- Version the cohort definition, feature transforms, weights, and ontology with every ranking snapshot.

## 15. Governance and evolution process

### Fixed in the next major release

- root entity kinds;
- the existing 17 engineering-category codes;
- evidence/provenance envelope;
- lifecycle roots;
- relationship families and temporal model;
- assignment/review states.

### Versioned and allowed to evolve

- entity leaf subtypes;
- architecture patterns and capability leaves;
- protocol and tool-access leaves;
- modality/deployment leaves;
- threat and governance-control leaves;
- curriculum roles and project patterns.

### Candidate promotion gate

A proposed term must have:

1. a clear definition, parent, scope note, inclusion/exclusion criteria, and examples;
2. at least three independent real entities or artifacts unless it represents a normative standard term;
3. demonstrated retrieval, ranking, or editorial utility on an eval set;
4. no semantic duplicate in the active ontology;
5. inter-reviewer agreement above the chosen threshold;
6. migration/compatibility notes and a responsible owner.

Track `proposed -> trial -> accepted -> deprecated -> retired`, with `replaced_by` mappings. Never delete an accepted term used by historical snapshots.

## 16. Recommended implementation sequence

1. Expand `entity_kind` so package/component, media artifact, protocol/standard, dataset, benchmark, model, release, event, concept/technique, course, and challenge no longer fall into `other`.
2. Preserve the 17 enum codes and seed the modern child-term table above.
3. Add normalized facet-assignment tables with evidence, confidence, observation time, and ontology version.
4. Add temporal relation assertions with a reviewed predicate registry.
5. Implement the control-regime, architecture-pattern, maturity, modality, deployment, risk, and curriculum vocabularies as versioned rows.
6. Build classifier evals around hard boundaries: workflow vs agent; product vs package vs repository; MCP vs A2A; eval vs observability; context memory vs retrieval; framework maturity vs adoption.
7. Backfill a stratified sample from every current engineering category, adjudicate disagreements, and adjust definitions before mass classification.
8. Make ranking and curriculum agents consume immutable taxonomy snapshots and expose the rationale/evidence for every selected feature.

## 17. Authoritative sources

Primary and standards sources used to ground this proposal:

- Anthropic, **Building effective agents** — workflow/agent distinction; augmented LLM; chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, autonomous-agent loop: https://www.anthropic.com/engineering/building-effective-agents
- OpenAI, **A practical guide to building agents** — model/tools/instructions; data/action/orchestration tools; single-agent and multi-agent orchestration; guardrails: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- Model Context Protocol, **Architecture overview** (2026-07-28 docs) — host/client/server architecture and protocol primitives: https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture
- Model Context Protocol, **Specification 2025-11-25** — versioned normative specification: https://modelcontextprotocol.io/specification/2025-11-25
- Google Developers Blog, **Announcing the Agent2Agent Protocol (A2A)** — capability discovery and cross-agent collaboration: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
- NIST, **AI Risk Management Framework** and GenAI Profile — Govern/Map/Measure/Manage and generative-AI risk-management guidance: https://www.nist.gov/itl/ai-risk-management-framework and https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- OWASP GenAI Security Project, **Top 10 for Agentic Applications for 2026** — current agentic threat vocabulary: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- OpenTelemetry, **Generative AI semantic conventions** — interoperable GenAI/agent observability attributes and spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OpenSSF, **Scorecard** — automated open-source security-health checks useful as repository health facets: https://github.com/ossf/scorecard
- CRediT, **Contributor Roles Taxonomy** — contribution-role vocabulary for papers and research artifacts: https://credit.niso.org/

## 18. Final recommendation

Adopt **“stable spine + governed facets + evidence-backed temporal relations”** as the ontology contract. The 17-category spine remains legible to humans and compatible with the current database. The additional facets capture the fast-moving realities of agentic architecture, protocols, memory, evaluation, deployment, risk, and pedagogy without requiring a breaking enum migration every time the field invents a new pattern or product label. This is the right substrate for both progressive discovery ranking and the later course/curriculum/challenge compiler.
