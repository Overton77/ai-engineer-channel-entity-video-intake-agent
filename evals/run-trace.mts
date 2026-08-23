import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MessageStreamEvent } from "eve/client";
import { evaluateTrace } from "./lib/trace-evaluation";

const args = process.argv.slice(2);
const inputPath = args.find((value) => !value.startsWith("--"));
if (!inputPath) {
  throw new Error("Usage: npm run eval:trace:file -- <events-or-eve-result.json> [--output report.json]");
}
const raw = JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
function eventsFrom(value: unknown): readonly MessageStreamEvent[] {
  if (Array.isArray(value)) return value as MessageStreamEvent[];
  if (!value || typeof value !== "object") throw new Error("Trace input must be an event array or Eve result object");
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.events)) return record.events as MessageStreamEvent[];
  const result = record.result;
  if (result && typeof result === "object") {
    const nested = result as Record<string, unknown>;
    if (Array.isArray(nested.events)) return nested.events as MessageStreamEvent[];
    if (nested.result && typeof nested.result === "object") {
      const task = nested.result as Record<string, unknown>;
      if (Array.isArray(task.events)) return task.events as MessageStreamEvent[];
    }
  }
  throw new Error("No Eve MessageStreamEvent[] found in trace input");
}
const report = evaluateTrace(`file:${inputPath}`, eventsFrom(raw));
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const outputIndex = args.indexOf("--output");
if (outputIndex >= 0 && args[outputIndex + 1]) {
  await writeFile(resolve(args[outputIndex + 1]!), serialized, "utf8");
}
process.stdout.write(serialized);
if (!report.passed) process.exitCode = 1;
