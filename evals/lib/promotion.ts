import type { EvaluationRunReport } from "./result";

export type PromotionDecision = {
  promoted: boolean;
  common_case_count: number;
  mean_score_delta: number;
  bootstrap_95_percent_interval: [number, number];
  gate_regressions: string[];
  reasons: string[];
};

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function pairedBootstrapInterval(
  deltas: readonly number[],
  iterations = 5_000,
  seed = 0x5eed,
): [number, number] {
  if (deltas.length === 0) return [0, 0];
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      sum += deltas[Math.floor(random() * deltas.length)]!;
    }
    samples.push(sum / deltas.length);
  }
  samples.sort((left, right) => left - right);
  return [
    samples[Math.floor(iterations * 0.025)]!,
    samples[Math.min(iterations - 1, Math.floor(iterations * 0.975))]!,
  ];
}

export function compareEvaluationRuns(
  baseline: EvaluationRunReport,
  candidate: EvaluationRunReport,
  options: { nonInferiorityMargin?: number; minimumImprovement?: number } = {},
): PromotionDecision {
  const nonInferiorityMargin = options.nonInferiorityMargin ?? 0.01;
  const minimumImprovement = options.minimumImprovement ?? 0;
  const baselineById = new Map(baseline.cases.map((item) => [item.id, item] as const));
  const pairs = candidate.cases.flatMap((next) => {
    const prior = baselineById.get(next.id);
    return prior ? [{ prior, next }] : [];
  });
  const gateRegressions = pairs.flatMap(({ prior, next }) => {
    const priorGates = new Map(
      prior.findings.filter((item) => item.severity === "gate").map((item) => [item.name, item]),
    );
    return next.findings.flatMap((item) => {
      const old = priorGates.get(item.name);
      return item.severity === "gate" && old?.passed && !item.passed
        ? [`${next.id}:${item.name}`]
        : [];
    });
  });
  const deltas = pairs.map(({ prior, next }) => next.score - prior.score);
  const meanDelta = deltas.length === 0
    ? 0
    : deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const interval = pairedBootstrapInterval(deltas);
  const reasons: string[] = [];
  if (pairs.length === 0) reasons.push("No common cases between baseline and candidate");
  if (gateRegressions.length > 0) reasons.push(`Gate regressions: ${gateRegressions.join(", ")}`);
  if (interval[0] < -nonInferiorityMargin) {
    reasons.push(
      `Lower confidence bound ${interval[0].toFixed(4)} exceeds non-inferiority margin -${nonInferiorityMargin}`,
    );
  }
  if (meanDelta < minimumImprovement) {
    reasons.push(`Mean score delta ${meanDelta.toFixed(4)} is below ${minimumImprovement}`);
  }
  return {
    promoted: reasons.length === 0,
    common_case_count: pairs.length,
    mean_score_delta: meanDelta,
    bootstrap_95_percent_interval: interval,
    gate_regressions: gateRegressions,
    reasons,
  };
}
