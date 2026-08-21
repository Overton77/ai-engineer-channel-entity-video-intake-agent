import type { ModelMessage } from "ai";

function textParts(messages: readonly ModelMessage[]): string[] {
  const values: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") values.push(message.content);
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
        values.push(part.text);
      }
    }
  }
  return values;
}

function newestUserMatch<T extends string>(
  messages: readonly ModelMessage[],
  pattern: RegExp,
): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    const parts = textParts([message]);
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const matches = [...parts[partIndex]!.matchAll(pattern)];
      const value = matches.at(-1)?.[1]?.toLowerCase() as T | undefined;
      if (value) return value;
    }
    // Stage capabilities belong to the current controller delivery only. An
    // older user turn must never re-enable a previous stage's tools/schema.
    return null;
  }
  return null;
}

export type ResearchStageName =
  | "transcript_taxonomy"
  | "web_context"
  | "organization_research"
  | "source_verification"
  | "curriculum";

export type SynthesisStageName =
  | "initial_summary"
  | "technology_library_summary"
  | "organization_profile"
  | "ingestion_intent";

export function researchStageFromMessages(
  messages: readonly ModelMessage[],
): ResearchStageName | null {
  const pattern = /\b(?:research_stage|stage)\s*[:=]?\s*[`"']?(transcript_taxonomy|web_context|organization_research|source_verification|curriculum)\b/gi;
  const explicit = newestUserMatch<ResearchStageName>(messages, pattern);
  if (explicit) return explicit;

  const recoveryPattern = /\b(?:missing(?:\s+registered)?\s+artifact\s+kinds?|save\s+only\s+the\s+missing(?:\s+registered)?\s+artifact\s+kinds?)\s*:?\s*[`"']?(run_manifest|transcript_analysis|taxonomy_classification|web_context|organization_research|source_verification|curriculum_signals)\b/gi;
  const artifact = newestUserMatch<string>(messages, recoveryPattern);
  if (artifact === "run_manifest" || artifact === "transcript_analysis" || artifact === "taxonomy_classification") {
    return "transcript_taxonomy";
  }
  if (artifact === "curriculum_signals") return "curriculum";
  return artifact as ResearchStageName | null;
}

export function isSynthesisTurn(messages: readonly ModelMessage[]): boolean {
  const text = textParts(messages).join("\n");
  return /\bSYNTHESIS phase\b/i.test(text) || /["']?phase["']?\s*[:=]\s*["']?synthesis\b/i.test(text);
}

export function synthesisStageFromMessages(
  messages: readonly ModelMessage[],
): SynthesisStageName | null {
  const pattern = /\b(?:synthesis_stage|stage)\s*[:=]?\s*[`"']?(initial_summary|technology_library_summary|organization_profile|ingestion_intent)\b/gi;
  const explicit = newestUserMatch<SynthesisStageName>(messages, pattern);
  if (explicit) return explicit;
  const recoveryPattern = /\b(?:missing(?:\s+registered)?\s+artifact\s+kinds?|save\s+only\s+the\s+missing(?:\s+registered)?\s+artifact\s+kinds?)\s*:?\s*[`"']?(initial_summary|technology_library_summary|organization_profile|ingestion_intent)\b/gi;
  return newestUserMatch<SynthesisStageName>(messages, recoveryPattern);
}
