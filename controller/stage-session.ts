export type ControllerResearchStage =
  | "transcript_taxonomy"
  | "web_context"
  | "organization_research"
  | "source_verification"
  | "curriculum";

export type ControllerSynthesisStage =
  | "initial_summary"
  | "technology_library_summary"
  | "organization_profile"
  | "ingestion_intent";

export type ControllerStageIdentity =
  | { phase: "research"; stage: ControllerResearchStage }
  | { phase: "synthesis"; stage: ControllerSynthesisStage };

export type ControllerStageSessionSummary = {
  controller_stage: ControllerStageIdentity;
  delivery_count: number;
};

const RESEARCH_STAGES = new Set<ControllerResearchStage>([
  "transcript_taxonomy",
  "web_context",
  "organization_research",
  "source_verification",
  "curriculum",
]);

const SYNTHESIS_STAGES = new Set<ControllerSynthesisStage>([
  "initial_summary",
  "technology_library_summary",
  "organization_profile",
  "ingestion_intent",
]);

/**
 * Recover the immutable stage identity from the controller-authored first
 * message in an Eve session. This intentionally ignores model output and
 * client context so recovery can verify a parked session from durable history.
 */
export function controllerStageIdentityFromMessage(
  message: string,
): ControllerStageIdentity | null {
  const synthesis = message.match(
    /\bsynthesis_stage\s*[:=]?\s*[`"']?(initial_summary|technology_library_summary|organization_profile|ingestion_intent)\b/i,
  )?.[1]?.toLowerCase() as ControllerSynthesisStage | undefined;
  if (synthesis) return { phase: "synthesis", stage: synthesis };

  const research = message.match(
    /\b(?:research_stage|stage)\s*[:=]?\s*[`"']?(transcript_taxonomy|web_context|organization_research|source_verification|curriculum)\b/i,
  )?.[1]?.toLowerCase() as ControllerResearchStage | undefined;
  return research ? { phase: "research", stage: research } : null;
}

export function canResumeControllerStageSession(
  actual: ControllerStageIdentity | null,
  expected: ControllerStageIdentity,
  deliveryCount: number,
  maximumDeliveries: number,
): boolean {
  return (
    actual?.phase === expected.phase &&
    actual.stage === expected.stage &&
    Number.isInteger(deliveryCount) &&
    deliveryCount >= 1 &&
    deliveryCount < maximumDeliveries
  );
}

/** Parse the tiny controller-owned recovery record persisted in Postgres. */
export function controllerStageSessionSummaryFromResult(
  value: unknown,
): ControllerStageSessionSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const stageValue = record.controller_stage;
  const deliveryCount = record.delivery_count;
  if (!stageValue || typeof stageValue !== "object") return null;
  const stageRecord = stageValue as Record<string, unknown>;
  const phase = stageRecord.phase;
  const stage = stageRecord.stage;
  if (!Number.isInteger(deliveryCount) || (deliveryCount as number) < 1) return null;
  if (phase === "research" && typeof stage === "string" && RESEARCH_STAGES.has(stage as ControllerResearchStage)) {
    return {
      controller_stage: { phase, stage: stage as ControllerResearchStage },
      delivery_count: deliveryCount as number,
    };
  }
  if (phase === "synthesis" && typeof stage === "string" && SYNTHESIS_STAGES.has(stage as ControllerSynthesisStage)) {
    return {
      controller_stage: { phase, stage: stage as ControllerSynthesisStage },
      delivery_count: deliveryCount as number,
    };
  }
  return null;
}
