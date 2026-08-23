import type {
  Assertion,
  AssertionEvaluation,
  AssertionSeverity,
} from "eve/evals";
import { clampScore } from "./result";

/** Preserve a domain grader's fractional 0–1 score in Eve artifacts/reporters. */
export function numericScore(
  name: string,
  severity: AssertionSeverity,
  threshold: number,
  message?: string,
): Assertion {
  const build = (nextSeverity: AssertionSeverity, nextThreshold?: number): Assertion => ({
    name,
    severity: nextSeverity,
    ...(nextThreshold === undefined ? {} : { threshold: nextThreshold }),
    score(value: unknown): number {
      return clampScore(typeof value === "number" ? value : Number(value));
    },
    evaluate(value: unknown): AssertionEvaluation {
      return {
        score: clampScore(typeof value === "number" ? value : Number(value)),
        ...(message ? { message } : {}),
      };
    },
    gate(value = 1): Assertion {
      return build("gate", value);
    },
    soft(value?: number): Assertion {
      return build("soft", value);
    },
    atLeast(value: number): Assertion {
      return build("soft", value);
    },
  });
  return build(severity, threshold);
}
