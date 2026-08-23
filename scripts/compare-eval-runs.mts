import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareEvaluationRuns } from "../evals/lib/promotion";
import type { EvaluationRunReport } from "../evals/lib/result";

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  throw new Error("Usage: npm run eval:compare -- <baseline.json> <candidate.json>");
}
const [baseline, candidate] = await Promise.all([
  readFile(resolve(baselinePath), "utf8").then((value) => JSON.parse(value) as EvaluationRunReport),
  readFile(resolve(candidatePath), "utf8").then((value) => JSON.parse(value) as EvaluationRunReport),
]);
const decision = compareEvaluationRuns(baseline, candidate);
console.log(JSON.stringify(decision, null, 2));
if (!decision.promoted) process.exitCode = 1;
