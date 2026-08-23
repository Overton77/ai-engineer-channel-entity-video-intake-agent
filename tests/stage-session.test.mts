import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canResumeControllerStageSession,
  controllerStageIdentityFromMessage,
  controllerStageSessionSummaryFromResult,
} from "../controller/stage-session";

describe("durable stage session identity", () => {
  it("recognizes every controller research stage", () => {
    for (const stage of [
      "transcript_taxonomy",
      "web_context",
      "organization_research",
      "source_verification",
      "curriculum",
    ] as const) {
      assert.deepEqual(
        controllerStageIdentityFromMessage(`This bounded turn is only stage ${stage}.`),
        { phase: "research", stage },
      );
    }
  });

  it("recognizes every controller synthesis stage without misclassifying it as research", () => {
    for (const stage of [
      "initial_summary",
      "technology_library_summary",
      "organization_profile",
      "ingestion_intent",
    ] as const) {
      assert.deepEqual(
        controllerStageIdentityFromMessage(`This bounded turn is only synthesis_stage ${stage}.`),
        { phase: "synthesis", stage },
      );
    }
  });

  it("rejects ordinary or model-authored prose without a controller stage marker", () => {
    assert.equal(controllerStageIdentityFromMessage("Continue from where you stopped."), null);
    assert.equal(controllerStageIdentityFromMessage("I researched the organization."), null);
  });

  it("reuses only a matching stage below the bounded delivery cap", () => {
    const expected = { phase: "research", stage: "web_context" } as const;
    assert.equal(canResumeControllerStageSession(expected, expected, 6, 18), true);
    assert.equal(
      canResumeControllerStageSession(
        { phase: "research", stage: "organization_research" },
        expected,
        6,
        18,
      ),
      false,
    );
    assert.equal(canResumeControllerStageSession(expected, expected, 18, 18), false);
    assert.equal(canResumeControllerStageSession(null, expected, 6, 18), false);
  });

  it("parses only valid controller-owned Postgres recovery metadata", () => {
    assert.deepEqual(
      controllerStageSessionSummaryFromResult({
        controller_stage: { phase: "research", stage: "source_verification" },
        delivery_count: 7,
      }),
      {
        controller_stage: { phase: "research", stage: "source_verification" },
        delivery_count: 7,
      },
    );
    assert.equal(
      controllerStageSessionSummaryFromResult({
        controller_stage: { phase: "research", stage: "not_a_stage" },
        delivery_count: 7,
      }),
      null,
    );
    assert.equal(
      controllerStageSessionSummaryFromResult({
        controller_stage: { phase: "synthesis", stage: "initial_summary" },
        delivery_count: 0,
      }),
      null,
    );
  });
});
