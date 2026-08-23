import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageStreamEvent } from "eve/client";
import { evaluateTrace } from "../evals/lib/trace-evaluation";

function event(type: string, data: unknown, index: number): MessageStreamEvent {
  return {
    type,
    data,
    meta: { id: `event-${index}`, at: `2026-08-22T00:00:${String(index).padStart(2, "0")}Z` },
  } as MessageStreamEvent;
}

function validWebContextTrace(searchCount = 1): MessageStreamEvent[] {
  const trace = { traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 };
  const events: MessageStreamEvent[] = [
    event("session.started", { trace }, 0),
    event("turn.started", { sequence: 0, turnId: "turn_0", trace }, 1),
    event(
      "message.received",
      {
        message: "Continue RESEARCH. This bounded turn is only stage web_context.",
        sequence: 0,
        turnId: "turn_0",
      },
      2,
    ),
  ];
  for (let index = 0; index < searchCount; index += 1) {
    events.push(
      event(
        "actions.requested",
        {
          actions: [{
            kind: "tool-call",
            callId: `search-${index}`,
            toolName: "web_search",
            input: { query: `query ${index}` },
          }],
          sequence: 0,
          stepIndex: index,
          turnId: "turn_0",
        },
        events.length,
      ),
      event(
        "action.result",
        {
          result: {
            kind: "tool-result",
            callId: `search-${index}`,
            toolName: "web_search",
            output: { results: [] },
          },
          status: "completed",
          sequence: 0,
          stepIndex: index,
          turnId: "turn_0",
        },
        events.length + 1,
      ),
    );
  }
  events.push(
    event(
      "actions.requested",
      {
        actions: [{
          kind: "tool-call",
          callId: "save-1",
          toolName: "save_research_stage_packet",
          input: { stage: "web_context" },
        }],
        sequence: 0,
        stepIndex: searchCount,
        turnId: "turn_0",
      },
      events.length,
    ),
    event(
      "action.result",
      {
        result: {
          kind: "tool-result",
          callId: "save-1",
          toolName: "save_research_stage_packet",
          output: { saved: true },
        },
        status: "completed",
        sequence: 0,
        stepIndex: searchCount,
        turnId: "turn_0",
      },
      events.length + 1,
    ),
    event(
      "step.completed",
      {
        finishReason: "stop",
        sequence: 0,
        stepIndex: searchCount + 1,
        turnId: "turn_0",
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
      },
      events.length + 2,
    ),
    event("turn.completed", { sequence: 0, turnId: "turn_0" }, events.length + 3),
  );
  return events;
}

describe("trace evaluation", () => {
  it("passes a correlated, bounded, stage-correct trajectory", () => {
    const result = evaluateTrace("valid", validWebContextTrace());
    assert.equal(result.passed, true);
    assert.equal(result.metrics.tool_call_count, 2);
    assert.equal(result.metrics.input_tokens, 100);
  });

  it("fails when the trajectory exceeds the stage search cap", () => {
    const result = evaluateTrace("over-budget", validWebContextTrace(4));
    const policy = result.findings.find((item) => item.name === "stage_tool_policy");
    assert.equal(policy?.passed, false);
    assert.match(policy?.message ?? "", /web_search used 4\/3/);
  });

  it("fails duplicate action results instead of silently accepting replay noise", () => {
    const events = validWebContextTrace();
    const firstResult = events.find((item) => item.type === "action.result")!;
    events.splice(events.length - 1, 0, {
      ...firstResult,
      meta: { ...firstResult.meta, id: "duplicate-result" },
    });
    const result = evaluateTrace("duplicate", events);
    assert.equal(
      result.findings.find((item) => item.name === "action_lifecycle_integrity")?.passed,
      false,
    );
  });
});
