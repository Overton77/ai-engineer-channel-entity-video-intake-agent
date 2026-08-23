import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  evaluatePacketDirectory,
  goldenPacketDirectory,
  loadGoldenPacketCases,
} from "./lib/packet-evaluation";
import { buildRunReport } from "./lib/result";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const outputFlag = args.indexOf("--output");
const outputPath = resolve(
  outputFlag >= 0 && args[outputFlag + 1]
    ? args[outputFlag + 1]!
    : ".eve/evals/offline/latest.json",
);
const rows = await loadGoldenPacketCases();
const cases = await Promise.all(
  rows.map((row) => evaluatePacketDirectory(row, goldenPacketDirectory(row))),
);
const report = buildRunReport(cases);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const item of cases) {
  const failed = item.findings.filter(
    (finding) => finding.severity === "gate" && !finding.passed,
  );
  console.log(
    `${item.passed ? "PASS" : "FAIL"} ${item.id} score=${item.score.toFixed(3)}${
      failed.length ? ` gates=${failed.map((finding) => finding.name).join(",")}` : ""
    }`,
  );
}
console.log(
  `summary passed=${report.summary.passed}/${report.summary.total} mean=${report.summary.mean_score.toFixed(3)} report=${outputPath}`,
);
if (strict && report.summary.failed > 0) process.exitCode = 1;
