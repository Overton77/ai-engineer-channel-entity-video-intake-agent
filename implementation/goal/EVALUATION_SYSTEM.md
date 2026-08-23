# Evaluation system for pre-research, ingestion, and optimization agents

**Status:** implemented initial system (`pre-research-eval-1.0.0`)  
**Date:** 2026-08-22  
**Framework:** Eve `0.38.3` native evals plus deterministic TypeScript graders

## Decision

Use Eve as the execution and trace-evaluation framework. Keep domain scoring in small, framework-neutral TypeScript functions. Do not add a second agent framework or a second source of trace truth.

This choice has the highest integration value because Eve already:

- executes `.eval.ts` datasets against the same HTTP/session surface as production;
- captures the complete typed event stream and derives tool/subagent lifecycle facts;
- supports hard gates, soft thresholds, dataset fan-out, remote targets, JUnit, and per-run artifacts;
- exposes W3C trace coordinates to reporters and locally records OTel traces;
- wraps Braintrust `autoevals` judges, while keeping the judge model separate from the model under test.

The evaluation design is deliberately hybrid. Outcome checks determine whether the system did the job. Trace checks explain how it did the job and catch policy violations. Model judges cover only semantic dimensions that deterministic code cannot represent. Human review calibrates the labels and judges.

## Research findings

### 1. Grade outcomes and trajectories, not only final prose

Anthropic's agent-eval guidance distinguishes the transcript/trace from the environment outcome and recommends combining code, model, and human graders. It also recommends repeated trials because model behavior is stochastic, and separates capability suites from near-100%-pass regression suites. OpenAI similarly recommends starting with trace grading to find workflow failures, then moving stable criteria into repeatable datasets and eval runs.

For this system, the environment outcome is the immutable packet, the ingestion intent, the execution receipt, and the resulting review/applied state. The trajectory is the Eve event stream: model steps, tool calls, results, budgets, and turn boundaries.

Sources:

- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [OpenAI — Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenAI — Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)
- [Eve — Evals overview](https://eve.dev/docs/evals/overview)

### 2. Research agents need separate retrieval, citation, and synthesis measurements

DeepResearch Bench evaluates report quality with reference-adaptive criteria and evaluates retrieval with effective-citation count and citation accuracy. BrowseComp isolates difficult-to-find, easy-to-verify facts and demonstrates why browsing persistence should be tested separately from open-ended report quality. RAG evaluation practice likewise separates retrieval precision/recall from answer faithfulness.

The pre-research agent therefore must not receive a single “report quality” score. It gets separate scores for evidence-reference integrity, citation verification, source authority/retrievability, semantic coverage, temporal handling, and search efficiency.

Sources:

- [DeepResearch Bench paper and benchmark](https://openreview.net/forum?id=hQ0K2Hhq7H)
- [DeepResearch Bench implementation](https://github.com/Ayanami0730/deep_research_bench)
- [OpenAI — BrowseComp](https://openai.com/index/browsecomp/)
- [Ragas — Context precision](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/)

### 3. Deterministic trajectory matching is highest value for fixed workflows

LangSmith's trajectory guidance distinguishes strict, unordered, subset, and superset matching. Fixed orchestration rules—lookup before mutation, bounded searches, exactly one save, no tool after save—should be deterministic. A trajectory judge is useful when several paths are valid and “efficient and reasonable” cannot be captured by rules.

The controller here has nine explicit stages, so hard-coded policy checks are both cheaper and more reliable than an LLM judge for most traces.

Source: [LangSmith — Trajectory evaluations](https://docs.langchain.com/langsmith/trajectory-evals)

### 4. Optimization requires protected gates and paired comparisons

“AI Agents That Matter” argues that agent evaluations must control cost, standardize comparisons, and focus on meaningful tasks rather than leaderboard-only accuracy. For this project, an optimizer is allowed to improve prompts, tools, models, retrieval, and controller code, but it may not trade away provenance, security, idempotency, or review boundaries.

Candidate promotion therefore uses the same labeled cases as the baseline, a paired score difference, a bootstrap confidence interval, and a no-regression rule on every protected gate. The evaluation policy and hidden holdout remain outside the optimizer's write scope.

Source: [Kapoor et al. — AI Agents That Matter](https://arxiv.org/abs/2407.01502)

## Highest-value evaluation set

The initial set is intentionally small and deep: eight immutable production packets spanning agent harnesses, evaluation platforms, frontier labs, vertical AI, retrieval, and a genuine review boundary. Three of those cases also receive semantic judge scoring. Real Eve session traces can be attached without replaying or reconstructing the agent.

| Priority | Evaluation | Target | Grader | Gate |
| --- | --- | --- | --- | --- |
| P0 | packet schema + cross-file identity | research/ingestion | deterministic | hard |
| P0 | evidence ID resolution | research/ingestion | deterministic | hard |
| P0 | canonical idempotency key + operation order | ingestion | deterministic | hard |
| P0 | receipt/intent/operation consistency | ingestion | deterministic state check | hard |
| P0 | expected apply vs review disposition | ingestion | expert label + deterministic | hard |
| P0 | tool lifecycle correlation | trace | Eve event stream | hard |
| P0 | stage tool allowlist and forbidden tools | trace | Eve event stream | hard |
| P0 | `3/3/2` search budgets and no post-save work | trace | Eve event stream | hard |
| P0 | no subagent fan-out; valid turn boundary | trace | Eve event stream | hard |
| P1 | primary category, organization, and domain | research | expert golden labels | hard |
| P1 | citation verification precision | research | deterministic | soft ≥ 0.80 |
| P1 | public retrievability | research | deterministic | soft ≥ 0.90 |
| P1 | grounded synthesis and uncertainty preservation | research | reference-aware judge | soft ≥ 0.80 |
| P1 | tokens, model steps, tool calls, cost | system | trace aggregation | tracked |
| P1 | candidate vs baseline paired bootstrap | optimizer | deterministic statistics | promotion gate |

### Composite score

The packet composite is diagnostic, not a substitute for hard gates:

```text
0.30 evidence grounding
0.20 verified/retrievable source quality
0.20 expert semantic labels
0.20 ingestion and terminal-state integrity
0.10 search efficiency and provenance
```

A run with a high composite still fails if any P0 gate fails. This prevents averaging away a fabricated citation, an identity mismatch, or a non-idempotent write.

## Trace evaluation contract

`evals/lib/trace-evaluation.ts` grades the native `MessageStreamEvent[]` captured by Eve. For every attached stage it checks:

1. a controller-authored phase/stage marker exists;
2. every event has a unique durable `meta.id`;
3. each tool request has exactly one completed result and no result is orphaned;
4. the stage uses only its allowed tools;
5. research calls exactly one `save_research_stage_packet`, synthesis calls exactly one `save_synthesis_stage_packet`;
6. the saved research stage matches the controller stage;
7. web searches stay within `0/3/3/2/0`, with none in synthesis;
8. no sandbox, file, question, todo, generic agent, or subagent fan-out occurs;
9. no tool is requested after the stage save;
10. the turn has a valid start/terminal order;
11. a W3C trace context is available (soft while old traces are migrated);
12. steps, tokens, calls, failures, and cost are recorded for Pareto comparison.

This is trace evaluation rather than log string matching: calls are correlated by `callId`, and durable event IDs expose duplicate replay artifacts.

Trace input has two supported paths: attach an existing session with the Eve eval target, or run `eval:trace:file` over an exported event array/Eve result artifact. Remote attachment is intentionally unavailable while the production channel uses `placeholderAuth()`; replacing production authentication is a separate security decision, not an eval workaround.

## Evaluation layers by agent

### Research agent

- **Acquisition:** source recall on annotated questions, authority fit, first sufficient authoritative source rank, duplicate rate, query budget, and source-class diversity.
- **Verification:** citation accuracy, effective citations, public retrievability, temporal alignment, conflict preservation, and prompt-injection isolation.
- **Synthesis:** claim coverage, evidence entailment, transcript-vs-web separation, uncertainty calibration, useful technical depth, and reference-aware pairwise preference.
- **Trajectory:** legal tools, bounded search, required save, no post-save drift, error recovery, cost, and latency.

### Ingestion agent/executor

- schema parsing and cross-file identities;
- exact allowlisted operation order;
- canonical idempotency key and replay equivalence;
- foreign-key/evidence resolution and deterministic stable IDs;
- atomic rollback on failure and exactly-once visible outcome under retries;
- apply/review state agreement, receipt hash agreement, and finished-marker invariants;
- downstream retrieval smoke checks after ingestion (next expansion).

### System-optimizing agent

- optimize only against a versioned development split;
- run untouched hidden temporal and organization/source-domain holdouts for promotion;
- require no protected-gate regression;
- use paired trials and confidence intervals rather than one noisy run;
- report quality, cost, latency, searches, and tokens as a Pareto surface;
- shadow/canary the candidate before wider promotion;
- add production failures to the dataset only after independent labeling;
- never let the optimizer edit the evaluator, labels, baseline, or promotion policy in the same change.

## Baseline and promotion workflow

1. Run `npm run eval:offline -- --output .eve/evals/baseline.json` on the current implementation.
2. Give the implementation agent the report, failed findings, and relevant trace artifacts—not the hidden holdout labels.
3. Make one coherent implementation or harness change.
4. Run unit tests, typecheck, deterministic packet evals, attached trace evals, then judge evals.
5. Write the candidate report to a separate immutable path.
6. Run `npm run eval:compare -- <baseline> <candidate>`.
7. Promote only if protected gates do not regress and the paired 95% interval meets the non-inferiority rule.
8. Shadow on fresh production traffic, sample traces for expert review, then canary.

The comparator defaults to a one-point non-inferiority margin and zero minimum mean improvement. Tighten this once the initial dataset reaches at least 40–50 stratified cases; eight cases are enough to expose regressions and validate the harness, not enough for a definitive population estimate.

## Current baseline interpretation

The local historical packet set deliberately contains pre-policy artifacts. The first offline run exposed legacy runs whose `web_context.searches` or `organization_research.searches` exceed the current maximum of three. These are useful regression fixtures: the evaluator is correctly refusing to normalize old invalid output into a passing score. Current-schema cases continue through the deeper grounding, semantic, source-quality, and receipt checks.

Do not rewrite those immutable artifacts to make the suite green. Either retain them as known-negative regression cases or recapture explicitly versioned current-policy positives.

## Next dataset expansion

Before using the score for autonomous optimization, expand to:

- 40–50 stratified packet cases: category, organization type, duration, temporal risk, source accessibility, and review disposition;
- at least 10 adversarial cases: prompt injection, copied/fake official source, stale API, acquisition/renaming ambiguity, empty web results, duplicate query, and partial tool failure;
- 10 long-transcript cases and 10 sparse/ambiguous talks;
- 3–5 trials per stochastic capability case, reporting both average success and consistency across all trials;
- a hidden temporal split and a hidden source-domain split;
- expert double-labeling of semantic cases, with disagreement adjudication and measured judge agreement;
- downstream retrieval checks so ingestion is rewarded for making the right information usable, not merely for writing valid rows.

## Framework integrations

- Keep Eve artifacts and the event stream as the canonical local evidence.
- Use `--junit` in CI for annotations and upload `.eve/evals/` on failure.
- Add Eve's Braintrust reporter only after data-export approval and `BRAINTRUST_API_KEY` setup. It can carry scores and Eve trace contexts without replacing the runner.
- Add an authored OTel exporter only when a remote trace backend is needed. Eve already records local traces when `agent/instrumentation.ts` is absent; adding that file replaces local recording and must be an intentional operational decision.
- Ragas or another retrieval-specific library may be introduced for a downstream retrieval benchmark, but it is not required for the current packet and trace gates.
