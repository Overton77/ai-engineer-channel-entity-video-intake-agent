import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  scheduledInvocationBudgetMs,
  scheduledRetryCooldownMinutes,
} from "../controller/scheduled-pre-research";

describe("scheduled retry cooldown", () => {
  it("defaults to ten minutes", () => {
    assert.equal(scheduledRetryCooldownMinutes(undefined), 10);
  });

  it("accepts bounded whole-minute overrides", () => {
    assert.equal(scheduledRetryCooldownMinutes("5"), 5);
    assert.equal(scheduledRetryCooldownMinutes("60"), 60);
  });

  it("rejects values that could disable fairness or stall the queue", () => {
    for (const value of ["0", "4", "61", "10.5", "not-a-number"]) {
      assert.throws(
        () => scheduledRetryCooldownMinutes(value),
        /must be an integer between 5 and 60/,
      );
    }
  });
});

describe("scheduled invocation budget", () => {
  it("defaults to four minutes so Vercel has a one-minute cleanup margin", () => {
    assert.equal(scheduledInvocationBudgetMs(undefined), 240_000);
  });

  it("accepts only budgets that leave at least thirty seconds below Vercel's limit", () => {
    assert.equal(scheduledInvocationBudgetMs("60000"), 60_000);
    assert.equal(scheduledInvocationBudgetMs("270000"), 270_000);
    for (const value of ["59999", "270001", "120000.5", "nope"]) {
      assert.throws(
        () => scheduledInvocationBudgetMs(value),
        /must be an integer between 60000 and 270000/,
      );
    }
  });
});
