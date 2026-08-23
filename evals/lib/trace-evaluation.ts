import type { MessageStreamEvent } from "eve/client";
import {
  controllerStageIdentityFromMessage,
  type ControllerStageIdentity,
} from "../../controller/stage-session";
import {
  finalizeCase,
  finding,
  weightedScore,
  type EvaluationCaseResult,
  type EvaluationFinding,
} from "./result";

type ToolRequest = {
  callId: string;
  input: Record<string, unknown>;
  name: string;
  index: number;
  turnId: string;
};

const FORBIDDEN_TOOLS = new Set([
  "agent",
  "ask_question",
  "bash",
  "glob",
  "grep",
  "read_file",
  "todo",
  "write_file",
]);

const SEARCH_CAPS: Partial<Record<ControllerStageIdentity["stage"], number>> = {
  web_context: 3,
  organization_research: 3,
  source_verification: 2,
};

function extractToolRequests(events: readonly MessageStreamEvent[]): ToolRequest[] {
  return events.flatMap((event, index) => {
    if (event.type !== "actions.requested") return [];
    return event.data.actions.flatMap((action) =>
      action.kind === "tool-call"
        ? [{
            callId: action.callId,
            input: action.input,
            name: action.toolName,
            index,
            turnId: event.data.turnId,
          }]
        : [],
    );
  });
}

function detectStage(
  events: readonly MessageStreamEvent[],
  expected?: ControllerStageIdentity,
): ControllerStageIdentity | null {
  if (expected) return expected;
  for (const event of events) {
    if (event.type !== "message.received") continue;
    const stage = controllerStageIdentityFromMessage(event.data.message);
    if (stage) return stage;
  }
  return null;
}

function allowedToolsForStage(stage: ControllerStageIdentity): Set<string> {
  if (stage.phase === "synthesis") {
    return new Set(["load_research_phase_packet", "save_synthesis_stage_packet"]);
  }
  const common = new Set(["load_pre_research_run", "load_taxonomy", "save_research_stage_packet"]);
  if (stage.stage === "web_context" || stage.stage === "organization_research" || stage.stage === "source_verification") {
    common.add("web_search");
    common.add("web_fetch");
    common.add("record_web_search_event");
  }
  return common;
}

function terminalEvent(event: MessageStreamEvent): boolean {
  return (
    event.type === "turn.completed" ||
    event.type === "turn.failed" ||
    event.type === "turn.cancelled" ||
    event.type === "session.waiting" ||
    event.type === "session.completed" ||
    event.type === "session.failed"
  );
}

export function evaluateTrace(
  id: string,
  events: readonly MessageStreamEvent[],
  expectedStage?: ControllerStageIdentity,
): EvaluationCaseResult {
  const findings: EvaluationFinding[] = [];
  const stage = detectStage(events, expectedStage);
  findings.push(
    finding({
      name: "bounded_stage_identity",
      score: stage ? 1 : 0,
      message: stage ? `${stage.phase}:${stage.stage}` : "No controller-authored stage marker found",
    }),
  );

  const ids = events.map((event) => event.meta?.id).filter(Boolean);
  const uniqueIds = new Set(ids);
  findings.push(
    finding({
      name: "durable_event_identity",
      score: ids.length === events.length && uniqueIds.size === ids.length ? 1 : 0,
      message: `${uniqueIds.size}/${events.length} events have unique durable IDs`,
    }),
  );

  const requests = extractToolRequests(events);
  const requestIds = new Set(requests.map((item) => item.callId));
  const resultEvents = events.filter((event) => event.type === "action.result");
  const resultsByCallId = new Map<string, typeof resultEvents>();
  for (const event of resultEvents) {
    const list = resultsByCallId.get(event.data.result.callId) ?? [];
    list.push(event);
    resultsByCallId.set(event.data.result.callId, list);
  }
  const lifecycleErrors: string[] = [];
  for (const request of requests) {
    const results = resultsByCallId.get(request.callId) ?? [];
    if (results.length !== 1) lifecycleErrors.push(`${request.callId} has ${results.length} results`);
    if (results.some((event) => event.data.status !== "completed")) {
      lifecycleErrors.push(`${request.callId} did not complete successfully`);
    }
  }
  for (const callId of resultsByCallId.keys()) {
    if (!requestIds.has(callId)) lifecycleErrors.push(`orphan result ${callId}`);
  }
  findings.push(
    finding({
      name: "action_lifecycle_integrity",
      score: lifecycleErrors.length === 0 ? 1 : 0,
      message: lifecycleErrors.join("; ") || undefined,
    }),
  );

  const policyErrors: string[] = [];
  if (stage) {
    const allowed = allowedToolsForStage(stage);
    for (const request of requests) {
      if (FORBIDDEN_TOOLS.has(request.name)) policyErrors.push(`forbidden tool ${request.name}`);
      else if (!allowed.has(request.name)) policyErrors.push(`out-of-stage tool ${request.name}`);
    }
    const saveTool = stage.phase === "research"
      ? "save_research_stage_packet"
      : "save_synthesis_stage_packet";
    const saveCalls = requests.filter((item) => item.name === saveTool);
    if (saveCalls.length !== 1) policyErrors.push(`expected exactly one ${saveTool}; saw ${saveCalls.length}`);
    for (const call of saveCalls) {
      if (call.input.stage !== stage.stage && stage.phase === "research") {
        policyErrors.push(`save stage ${String(call.input.stage)} does not match ${stage.stage}`);
      }
    }
    const searchCalls = requests.filter((item) => item.name === "web_search").length;
    const searchCap = SEARCH_CAPS[stage.stage] ?? 0;
    if (searchCalls > searchCap) policyErrors.push(`web_search used ${searchCalls}/${searchCap}`);
    if (stage.phase === "synthesis" && requests.some((item) => item.name === "web_search")) {
      policyErrors.push("synthesis called web_search");
    }
    const lastSaveIndex = saveCalls.at(-1)?.index;
    if (lastSaveIndex !== undefined && requests.some((item) => item.index > lastSaveIndex)) {
      policyErrors.push("tool requested after the stage save call");
    }
  }
  findings.push(
    finding({
      name: "stage_tool_policy",
      score: policyErrors.length === 0 ? 1 : 0,
      message: policyErrors.join("; ") || undefined,
    }),
  );

  const subagentCount = events.filter(
    (event) => event.type === "subagent.called" || event.type === "subagent.started",
  ).length;
  findings.push(
    finding({
      name: "no_subagent_fanout",
      score: subagentCount === 0 ? 1 : 0,
      message: `${subagentCount} subagent lifecycle events`,
    }),
  );

  const firstTurnStart = events.findIndex((event) => event.type === "turn.started");
  let lastTerminal = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (terminalEvent(events[index]!)) {
      lastTerminal = index;
      break;
    }
  }
  const orderingOk = firstTurnStart >= 0 && lastTerminal > firstTurnStart;
  findings.push(
    finding({
      name: "turn_boundary_order",
      score: orderingOk ? 1 : 0,
      message: `turn.started index=${firstTurnStart}; terminal index=${lastTerminal}`,
    }),
  );

  const hasTraceContext = events.some(
    (event) =>
      (event.type === "session.started" || event.type === "turn.started") &&
      Boolean(event.data.trace?.traceId && event.data.trace?.spanId),
  );
  findings.push(
    finding({
      name: "trace_context_available",
      severity: "score",
      score: hasTraceContext ? 1 : 0,
      threshold: 1,
      message: hasTraceContext ? undefined : "No W3C trace context was captured",
    }),
  );

  const stepEvents = events.filter((event) => event.type === "step.completed");
  const inputTokens = stepEvents.reduce((sum, event) => sum + (event.data.usage?.inputTokens ?? 0), 0);
  const outputTokens = stepEvents.reduce((sum, event) => sum + (event.data.usage?.outputTokens ?? 0), 0);
  const costUsd = stepEvents.reduce((sum, event) => sum + (event.data.usage?.costUsd ?? 0), 0);
  const policyScore = policyErrors.length === 0 ? 1 : 0;
  const lifecycleScore = lifecycleErrors.length === 0 ? 1 : 0;
  const score = weightedScore([
    { score: stage ? 1 : 0, weight: 0.15 },
    { score: policyScore, weight: 0.35 },
    { score: lifecycleScore, weight: 0.25 },
    { score: orderingOk ? 1 : 0, weight: 0.15 },
    { score: hasTraceContext ? 1 : 0, weight: 0.1 },
  ]);
  return finalizeCase({
    id,
    suite: "trace",
    score,
    findings,
    metrics: {
      event_count: events.length,
      tool_call_count: requests.length,
      model_step_count: stepEvents.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      failed_action_count: lifecycleErrors.length,
      subagent_count: subagentCount,
    },
    metadata: stage ? { phase: stage.phase, stage: stage.stage } : undefined,
  });
}
