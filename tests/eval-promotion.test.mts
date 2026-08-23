import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareEvaluationRuns } from "../evals/lib/promotion";
import { buildRunReport, finding, finalizeCase } from "../evals/lib/result";

function report(score: number, gatePassed = true) {
  return buildRunReport(
    [
      finalizeCase({
        id: "case-1",
        suite: "packet",
        score,
        findings: [finding({ name: "protected_gate", score: gatePassed ? 1 : 0 })],
        metrics: {},
      }),
    ],
    "2026-08-22T00:00:00Z",
  );
}

describe("evaluation promotion policy", () => {
  it("promotes a candidate that improves without a protected-gate regression", () => {
    const decision = compareEvaluationRuns(report(0.7), report(0.8));
    assert.equal(decision.promoted, true);
    assert.equal(decision.mean_score_delta > 0, true);
  });

  it("blocks a score improvement that regresses a protected gate", () => {
    const decision = compareEvaluationRuns(report(0.7), report(0.9, false));
    assert.equal(decision.promoted, false);
    assert.deepEqual(decision.gate_regressions, ["case-1:protected_gate"]);
  });
});
