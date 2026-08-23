export type EvaluationSeverity = "gate" | "score";

export type EvaluationFinding = {
  name: string;
  severity: EvaluationSeverity;
  score: number;
  threshold: number;
  passed: boolean;
  message?: string;
};

export type EvaluationCaseResult = {
  id: string;
  suite: "packet" | "trace";
  passed: boolean;
  score: number;
  findings: EvaluationFinding[];
  metrics: Record<string, number>;
  metadata?: Record<string, unknown>;
};

export type EvaluationRunReport = {
  schema_version: "1.0.0";
  evaluation_policy_version: string;
  generated_at: string;
  cases: EvaluationCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    mean_score: number;
  };
};

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function finding(input: {
  name: string;
  score: number;
  severity?: EvaluationSeverity;
  threshold?: number;
  message?: string;
}): EvaluationFinding {
  const score = clampScore(input.score);
  const severity = input.severity ?? "gate";
  const threshold = input.threshold ?? (severity === "gate" ? 1 : 0);
  return {
    name: input.name,
    severity,
    score,
    threshold,
    passed: score >= threshold,
    ...(input.message ? { message: input.message } : {}),
  };
}

export function weightedScore(
  values: ReadonlyArray<{ score: number; weight: number }>,
): number {
  const weight = values.reduce((sum, item) => sum + item.weight, 0);
  if (weight <= 0) return 0;
  return clampScore(
    values.reduce((sum, item) => sum + clampScore(item.score) * item.weight, 0) / weight,
  );
}

export function finalizeCase(input: Omit<EvaluationCaseResult, "passed">): EvaluationCaseResult {
  return {
    ...input,
    passed: input.findings.every(
      (item) => item.severity !== "gate" || item.passed,
    ),
  };
}

export function buildRunReport(
  cases: EvaluationCaseResult[],
  generatedAt = new Date().toISOString(),
): EvaluationRunReport {
  const passed = cases.filter((item) => item.passed).length;
  return {
    schema_version: "1.0.0",
    evaluation_policy_version: "pre-research-eval-1.0.0",
    generated_at: generatedAt,
    cases,
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      mean_score:
        cases.length === 0
          ? 0
          : cases.reduce((sum, item) => sum + item.score, 0) / cases.length,
    },
  };
}
