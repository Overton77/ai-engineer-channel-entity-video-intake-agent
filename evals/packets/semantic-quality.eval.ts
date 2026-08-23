import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineEval } from "eve/evals";
import { ARTIFACT_FILENAMES } from "../../executor/artifacts";
import {
  goldenPacketDirectory,
  loadGoldenPacketCases,
} from "../lib/packet-evaluation";

const selected = (await loadGoldenPacketCases()).filter((row) =>
  ["intuit-grounded-financial-ai", "llamaindex-retrieval-platform", "stealth-company-review-boundary"].includes(row.id),
);

export default selected.map((row) =>
  defineEval({
    description: `Reference-aware judge checks for nuanced synthesis quality in ${row.id}.`,
    tags: ["judge", "packet", "capability"],
    metadata: { video_id: row.video_id, run_id: row.run_id },
    async test(t) {
      const directory = goldenPacketDirectory(row);
      if (!existsSync(directory)) t.skip(`Golden packet is not materialized at ${directory}`);
      const [transcript, summary, profile] = await Promise.all([
        readFile(join(directory, ARTIFACT_FILENAMES.transcript_analysis), "utf8"),
        readFile(join(directory, ARTIFACT_FILENAMES.initial_summary), "utf8"),
        readFile(join(directory, ARTIFACT_FILENAMES.organization_profile), "utf8"),
      ]);
      const evidence = JSON.stringify({
        expected: row.expected,
        transcript_analysis: JSON.parse(transcript),
        initial_summary: JSON.parse(summary),
        organization_profile: JSON.parse(profile),
      });
      t.judge.autoevals
        .closedQA(
          "The synthesis preserves the transcript's central technical claims, clearly separates transcript claims from external context, avoids unsupported specifics, and is useful to an advanced AI-engineering curriculum.",
          { on: evidence },
        )
        .label("grounded_synthesis_quality")
        .atLeast(0.8);
      t.judge.autoevals
        .closedQA(
          "The primary organization and its domain match the supplied expected labels, and material ownership or identity uncertainty is preserved as review-required rather than guessed away.",
          { on: evidence },
        )
        .label("organization_resolution_quality")
        .atLeast(0.8);
    },
  }),
);
