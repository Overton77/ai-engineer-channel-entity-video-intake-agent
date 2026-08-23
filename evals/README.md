# Pre-research evaluation system

This directory is the executable evaluation contract for the research, ingestion, and optimization loop. The design rationale and research are in [`../implementation/goal/EVALUATION_SYSTEM.md`](../implementation/goal/EVALUATION_SYSTEM.md).

## Fast paths

```powershell
# Deterministic packet/outcome evaluation; writes .eve/evals/offline/latest.json
npm run eval:offline

# Same evaluation with a non-zero exit when any protected gate fails
npm run eval:offline:strict

# Discover all Eve-native cases without executing them
npm run eval:list

# Run deterministic Eve dataset cases
npm run eval -- packets/golden --strict

# Run the calibrated semantic-judge subset (AI Gateway credentials required)
npm run eval:judge

# Grade one or more existing Eve session trajectories
$env:PRE_RESEARCH_EVAL_SESSION_IDS='session-id-1,session-id-2'
npm run eval:trace -- --url https://research-starter-pre-research-agent.vercel.app

# Or grade an exported Eve event array/result without contacting a target
npm run eval:trace:file -- path/to/events-or-eve-result.json

# Compare a candidate report with an immutable baseline
npm run eval:compare -- .eve/evals/baseline.json .eve/evals/candidate.json
```

The attached trace eval consumes the real Eve event stream. It checks durable event IDs, stage identity, request/result correlation, tool allowlists, the `3/3/2` search budgets, exactly one stage save, no post-save tool activity, no subagent fan-out, turn boundaries, trace context, and token/cost totals.

Remote attachment requires a production-capable auth policy. The current channel still includes `placeholderAuth()`, which intentionally rejects production eval access; use a local target or configure the project's real auth provider before running the remote example. Do not weaken production auth just to make an eval connect.

## Dataset policy

- `data/golden-packet-cases.json` contains only expert labels and stable run identities. The immutable packets remain the evidence-bearing fixture.
- Add production failures only after reviewing and labeling them. Never let an optimizing agent rewrite expected labels or promotion gates.
- Keep capability and regression cases distinct. A case graduates to regression only after it is stable across repeated trials.
- Split future data by video/event, organization, source domain, and time. Near-duplicate talks must not cross train/tune and holdout boundaries.
- Run judge cases only after deterministic gates. Judge scores are diagnostic until agreement with expert labels is measured.

## Promotion rule

`eval:compare` uses paired cases and a seeded bootstrap interval. A candidate is rejected if it regresses any previously passing hard gate, has no common cases, or its lower 95% score-difference bound breaches the 1-point non-inferiority margin. This is intentionally conservative; cost or latency wins do not excuse provenance, safety, identity, or idempotency regressions.
