import { existsSync } from "node:fs";
import { defineEval } from "eve/evals";
import {
  evaluatePacketDirectory,
  goldenPacketDirectory,
  loadGoldenPacketCases,
} from "../lib/packet-evaluation";
import { numericScore } from "../lib/eve-assertions";

const rows = await loadGoldenPacketCases();

export default rows.map((row) =>
  defineEval({
    description: `Deterministic packet, provenance, ingestion, and outcome gates for ${row.id}.`,
    tags: ["offline", "packet", "regression"],
    metadata: { video_id: row.video_id, run_id: row.run_id },
    async test(t) {
      const directory = goldenPacketDirectory(row);
      if (!existsSync(directory)) t.skip(`Golden packet is not materialized at ${directory}`);
      const result = await evaluatePacketDirectory(row, directory);
      for (const item of result.findings) {
        t.check(
          item.score,
          numericScore(
            item.name,
            item.severity === "score" ? "soft" : "gate",
            item.threshold,
            item.message,
          ),
        ).label(item.name);
      }
      t.log(JSON.stringify({ score: result.score, metrics: result.metrics }));
    },
  }),
);
