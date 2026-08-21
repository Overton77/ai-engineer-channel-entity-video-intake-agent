import { parseIngestionIntent } from "../contracts/ingestion-intent";
import { normalizeApplicationDomainCode } from "../lib/application-domain";
import { query, withTransaction } from "../executor/postgres";
import { downloadJsonObject } from "../executor/storage";
import { loadEnv } from "./load-env.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId) throw new Error("usage: repair-run-domains <run-id>");
const ledger = await query<{ storage_bucket: string; storage_path: string }>(
  `select storage_bucket, storage_path from public.research_ingestion_intent where run_id = $1`,
  [runId],
);
if (ledger.length !== 1) throw new Error(`expected one intent ledger row for ${runId}`);
const intent = parseIngestionIntent(
  (await downloadJsonObject(ledger[0]!.storage_bucket, ledger[0]!.storage_path)).json,
);
const operation = intent.operations.find((item) => item.kind === "replace_domain_assignments");
if (!operation || operation.kind !== "replace_domain_assignments") {
  throw new Error("intent has no replace_domain_assignments operation");
}
await withTransaction(async (client) => {
  const analyses = await client.query<{ analysis_id: string }>(
    `select analysis_id from public.research_video_analysis where run_id = $1`,
    [runId],
  );
  if (analyses.rows.length !== 1) throw new Error(`expected one analysis for ${runId}`);
  const analysisId = analyses.rows[0]!.analysis_id;
  await client.query(`delete from public.research_video_domain where analysis_id = $1`, [analysisId]);
  const seen = new Set<string>();
  for (const row of operation.payload) {
    const domainCode = normalizeApplicationDomainCode(row.domain_code, row.rationale);
    if (seen.has(domainCode)) continue;
    seen.add(domainCode);
    await client.query(
      `insert into public.research_video_domain (analysis_id, domain_code, confidence, rationale)
       values ($1, $2, $3, $4)`,
      [analysisId, domainCode, row.confidence, row.rationale],
    );
  }
});
console.log(JSON.stringify({ repaired: true, run_id: runId }));
