---
description: Use when classifying a video into the official AI engineering category spine or choosing application domains.
---

# Official taxonomy v1.0.0

Call `load_taxonomy` for the live definitions. Do not invent category codes.

## Engineering spine (Postgres enum)

Pick exactly one primary. Up to three secondary. If two primaries seem equally good, choose one and put the other in `alternative`.

1. `model_foundations_behavior` — the model itself: architecture, scaling, tokenization, sampling, intrinsic behavior
2. `inference_model_systems` — serving, KV cache, quantization, speculative decoding
3. `ai_data_engineering` — labeling, synthetic data, curation, data quality
4. `post_training_continual_learning` — SFT, RLHF, DPO, LoRA, continual learning
5. `prompting_llm_programming` — prompts, structured output, LLM programming
6. `context_engineering_memory` — context construction, memory, compaction, state
7. `retrieval_search_knowledge` — RAG, embeddings, hybrid search, knowledge bases
8. `agent_architecture_harnesses` — agent loops, planning, multi-agent, harnesses
9. `tools_protocols_integrations` — tool calling, MCP, A2A, connectors
10. `orchestration_durable_execution` — workflows, queues, retries, durable runtimes
11. `coding_agents_software_engineering` — coding agents, codegen, PR/IDE agents
12. `evaluation_testing_benchmarking` — evals, benches, judges, test methodology
13. `observability_reliability_llmops` — tracing, LLMOps, production quality
14. `security_safety_identity_governance` — prompt injection, authz, guardrails, policy
15. `multimodal_realtime_systems` — voice, vision, speech, realtime
16. `ai_product_ux_human_factors` — UX, HITL, trust, product design
17. `ai_platforms_developer_tooling` — gateways, SDKs, builder platforms

## Tie-breakers

- Coding-agent product > general agent architecture
- Durable workflow engine > in-memory agent loop
- RAG/index design > generic data pipelines
- Offline eval methodology > production tracing
- Model-intrinsic alignment > product safety UX

## Application domains

Use lookup codes from `load_taxonomy`, including `general_purpose` when no vertical fits. Do not invent domain codes.

## Not organization domains

`research_organization_domain_code` is a separate taxonomy for the featured company/unit. Load `organization-taxonomy` for those codes. Do not reuse engineering category codes as organization domains, and do not classify the video topic as the organization's durable role.
