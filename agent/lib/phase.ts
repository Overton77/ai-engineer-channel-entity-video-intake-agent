import type { DynamicResolveContext } from "eve/instructions";
import type { ModelMessage } from "ai";
import { asIsoDate, loadPreResearchRun, type PreResearchRun } from "./run-access";

export type RunPhase = "research" | "synthesis";

export type ResolvedRunPhase = {
  phase: RunPhase;
  run: PreResearchRun;
  research_as_of: string;
};

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const RUN_ID_LABEL_RE =
  /["']?run_id["']?\s*[:=]\s*["']?([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

function utcDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function messageTexts(messages: readonly ModelMessage[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      texts.push(message.content);
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        texts.push(part.text);
      }
    }
  }
  return texts;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function asPhase(value: unknown): RunPhase | null {
  return value === "research" || value === "synthesis" ? value : null;
}

function asRunId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(UUID_RE);
  return match?.[0]?.toLowerCase() ?? null;
}

function collectHintObjects(
  ctx: DynamicResolveContext,
  texts: readonly string[],
): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  if (ctx.channel.metadata) objects.push(ctx.channel.metadata);
  for (const text of texts) {
    const parsed = parseJsonObject(text);
    if (parsed) objects.push(parsed);
  }
  return objects;
}

function hintsFromContext(ctx: DynamicResolveContext): {
  phase: RunPhase | null;
  runId: string | null;
} {
  const texts = messageTexts(ctx.messages);
  let phase: RunPhase | null = null;
  let runId: string | null = null;

  for (const object of collectHintObjects(ctx, texts)) {
    phase ??= asPhase(object.phase);
    runId ??= asRunId(object.run_id);
  }

  if (!runId) {
    for (const text of texts) {
      const labeled = text.match(RUN_ID_LABEL_RE)?.[1];
      if (labeled) {
        runId = labeled.toLowerCase();
        break;
      }
    }
  }

  if (!runId) {
    for (const text of texts) {
      const match = text.match(UUID_RE);
      if (match?.[0]) {
        runId = match[0].toLowerCase();
        break;
      }
    }
  }

  return { phase, runId };
}

export function phaseFromRunStatus(status: string): RunPhase | null {
  if (status === "synthesizing" || status === "intent_ready") return "synthesis";
  if (status === "claimed" || status === "analyzing") return "research";
  if (status === "research_complete") return "synthesis";
  return null;
}

export async function resolveRunPhase(
  ctx: DynamicResolveContext,
): Promise<ResolvedRunPhase | null> {
  try {
    const hints = hintsFromContext(ctx);
    if (!hints.runId) return null;

    const run = await loadPreResearchRun(hints.runId);
    const phase = hints.phase ?? phaseFromRunStatus(run.status);
    if (!phase) return null;

    return {
      phase,
      run,
      research_as_of: asIsoDate(run.research_as_of) ?? utcDateToday(),
    };
  } catch {
    return null;
  }
}
