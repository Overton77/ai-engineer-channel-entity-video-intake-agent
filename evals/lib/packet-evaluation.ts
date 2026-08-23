import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  intentOperationKinds,
  computeIntentIdempotencyKey,
  type IngestionIntent,
} from "../../contracts/ingestion-intent";
import {
  preResearchPacketSchema,
  validatePreResearchPacketCrossFile,
  type PreResearchPacket,
} from "../../contracts/pre-research-packet";
import {
  executionReceiptSchema,
  type ExecutionReceipt,
} from "../../contracts/execution-receipt";
import { hashIntent } from "../../executor/apply-intent";
import {
  APPLY_ARTIFACT_KINDS,
  ARTIFACT_FILENAMES,
} from "../../executor/artifacts";
import {
  finalizeCase,
  finding,
  weightedScore,
  type EvaluationCaseResult,
  type EvaluationFinding,
} from "./result";

export const goldenPacketCaseSchema = z.object({
  id: z.string().min(1),
  video_id: z.string().min(1),
  run_id: z.uuid(),
  expected: z.object({
    primary_category: z.string().min(1),
    primary_organization: z.string().min(1),
    primary_organization_domain: z.string().min(1),
    profile_review_required: z.boolean(),
    disposition: z.enum(["applied", "review_required"]),
    minimum_evidence_anchors: z.number().int().positive(),
  }),
});

export type GoldenPacketCase = z.infer<typeof goldenPacketCaseSchema>;

export async function loadGoldenPacketCases(
  path = resolve("evals/data/golden-packet-cases.json"),
): Promise<GoldenPacketCase[]> {
  return z.array(goldenPacketCaseSchema).parse(JSON.parse(await readFile(path, "utf8")));
}

export function goldenPacketDirectory(
  row: GoldenPacketCase,
  outputsRoot = resolve("outputs/pre-research/v2"),
): string {
  return join(outputsRoot, row.video_id, row.run_id);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadPacketDirectory(directory: string): Promise<{
  packet: PreResearchPacket;
  receipt: ExecutionReceipt | null;
}> {
  const artifacts: Record<string, unknown> = {};
  for (const kind of APPLY_ARTIFACT_KINDS) {
    artifacts[kind] = await readJson(join(directory, ARTIFACT_FILENAMES[kind]));
  }
  const packet = preResearchPacketSchema.parse({
    ...artifacts,
    evidence_grades_used: (artifacts.ingestion_intent as IngestionIntent)
      .evidence_grades_used,
  });
  let receipt: ExecutionReceipt | null = null;
  try {
    receipt = executionReceiptSchema.parse(
      await readJson(join(directory, ARTIFACT_FILENAMES.execution_receipt)),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && !(error instanceof z.ZodError)) throw error;
  }
  return { packet, receipt };
}

function collectEvidenceIds(value: unknown, target = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceIds(item, target);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.evidence_ids)) {
      for (const id of record.evidence_ids) if (typeof id === "string") target.add(id);
    }
    if (typeof record.evidence_id === "string") target.add(record.evidence_id);
    for (const [key, nested] of Object.entries(record)) {
      if (key !== "evidence_ids" && key !== "evidence_id") collectEvidenceIds(nested, target);
    }
  }
  return target;
}

function searchBudgetScore(intent: IngestionIntent): {
  score: number;
  counts: Record<string, number>;
  errors: string[];
} {
  const operation = intent.operations.find(
    (item) => item.kind === "record_web_search_events",
  );
  const rows = operation?.kind === "record_web_search_events" ? operation.payload : [];
  const caps: Record<string, number> = {
    web_context_scout: 3,
    organization_researcher: 3,
    source_verifier: 2,
  };
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    counts[row.subagent] = (counts[row.subagent] ?? 0) + 1;
    const key = `${row.subagent}:${row.query.trim().toLowerCase()}`;
    if (seen.has(key)) errors.push(`duplicate search query: ${key}`);
    seen.add(key);
    const resultUrls = new Set(row.result_urls);
    if (row.selected_urls.some((url) => !resultUrls.has(url))) {
      errors.push(`selected URL was absent from results for query: ${row.query}`);
    }
  }
  for (const [label, count] of Object.entries(counts)) {
    if (!(label in caps)) errors.push(`unknown search stage label: ${label}`);
    else if (count > caps[label]!) errors.push(`${label} used ${count}/${caps[label]} searches`);
  }
  return { score: errors.length === 0 ? 1 : 0, counts, errors };
}

export function evaluatePacket(
  row: GoldenPacketCase,
  packet: PreResearchPacket,
  receipt: ExecutionReceipt | null,
): EvaluationCaseResult {
  const findings: EvaluationFinding[] = [];
  const cross = validatePreResearchPacketCrossFile(packet);
  findings.push(
    finding({
      name: "cross_file_contract",
      score: cross.ok ? 1 : 0,
      message: cross.errors.join("; ") || undefined,
    }),
  );

  const intent = packet.ingestion_intent;
  const expectedKey = computeIntentIdempotencyKey({
    schema_version: intent.schema_version,
    source: intent.source,
    evidence_grades_used: intent.evidence_grades_used,
    operations: intent.operations,
  });
  findings.push(
    finding({
      name: "idempotency_key",
      score: intent.idempotency_key === expectedKey ? 1 : 0,
      message:
        intent.idempotency_key === expectedKey
          ? undefined
          : "Intent idempotency key does not match canonical content",
    }),
  );

  const operationKinds = intent.operations.map((item) => item.kind);
  findings.push(
    finding({
      name: "operation_completeness",
      score:
        operationKinds.length === intentOperationKinds.length &&
        operationKinds.every((kind, index) => kind === intentOperationKinds[index])
          ? 1
          : 0,
      message: `observed operations: ${operationKinds.join(", ")}`,
    }),
  );

  const known = new Set(packet.transcript_analysis.evidence_anchors.map((item) => item.evidence_id));
  const evidenceOperation = intent.operations.find((item) => item.kind === "replace_evidence_anchors");
  if (evidenceOperation?.kind === "replace_evidence_anchors") {
    for (const anchor of evidenceOperation.payload) known.add(anchor.evidence_id);
  }
  const referenced = collectEvidenceIds([
    packet.organization_research,
    packet.initial_summary,
    packet.technology_library_summary,
    packet.organization_profile,
    intent.operations,
  ]);
  const validReferences = [...referenced].filter((id) => known.has(id)).length;
  const groundingScore = referenced.size === 0 ? 1 : validReferences / referenced.size;
  findings.push(
    finding({
      name: "evidence_reference_integrity",
      score: groundingScore,
      message: `${validReferences}/${referenced.size} referenced evidence IDs resolve`,
    }),
  );
  findings.push(
    finding({
      name: "evidence_anchor_coverage",
      score: Math.min(
        1,
        packet.transcript_analysis.evidence_anchors.length /
          row.expected.minimum_evidence_anchors,
      ),
      threshold: 1,
      message: `${packet.transcript_analysis.evidence_anchors.length} anchors; expected at least ${row.expected.minimum_evidence_anchors}`,
    }),
  );

  const verifiedResources = packet.source_verification.resources;
  const citationAccuracy =
    verifiedResources.length === 0
      ? 0
      : verifiedResources.filter((item) => item.verification_status === "verified").length /
        verifiedResources.length;
  const retrievability =
    verifiedResources.length === 0
      ? 0
      : verifiedResources.filter((item) => item.publicly_retrievable).length /
        verifiedResources.length;
  findings.push(
    finding({
      name: "verified_source_precision",
      severity: "score",
      score: citationAccuracy,
      threshold: 0.8,
      message: `${verifiedResources.filter((item) => item.verification_status === "verified").length}/${verifiedResources.length} checked resources are verified`,
    }),
    finding({
      name: "source_retrievability",
      severity: "score",
      score: retrievability,
      threshold: 0.9,
    }),
  );

  const profile = packet.organization_profile;
  const primary = profile.primary_featured_organization;
  const semantics = [
    primary?.canonical_name === row.expected.primary_organization,
    profile.primary_domain_code === row.expected.primary_organization_domain,
    packet.taxonomy_classification.primary.category_code === row.expected.primary_category,
    profile.review_required === row.expected.profile_review_required,
  ];
  const semanticScore = semantics.filter(Boolean).length / semantics.length;
  findings.push(
    finding({
      name: "golden_semantic_labels",
      score: semanticScore,
      message: `organization=${primary?.canonical_name ?? "none"}; domain=${profile.primary_domain_code}; category=${packet.taxonomy_classification.primary.category_code}; review=${profile.review_required}`,
    }),
  );

  const search = searchBudgetScore(intent);
  findings.push(
    finding({
      name: "search_budget_and_provenance",
      score: search.score,
      message: search.errors.join("; ") || undefined,
    }),
  );

  let receiptScore = row.expected.disposition === "review_required" ? (receipt === null ? 1 : 0) : 0;
  if (row.expected.disposition === "applied" && receipt) {
    const receiptOperationsOk =
      receipt.operations.length === intent.operations.length &&
      receipt.operations.every(
        (item, index) =>
          item.operation_index === index &&
          item.kind === intent.operations[index]?.kind &&
          (item.status === "applied" || item.status === "skipped"),
      );
    receiptScore =
      receipt.run_id === row.run_id &&
      receipt.video_id === row.video_id &&
      receipt.intent_id === intent.intent_id &&
      receipt.intent_sha256 === hashIntent(intent) &&
      (receipt.status === "applied" || receipt.status === "already_applied") &&
      receiptOperationsOk
        ? 1
        : 0;
  }
  findings.push(
    finding({
      name: "terminal_outcome",
      score: receiptScore,
      message:
        row.expected.disposition === "applied"
          ? `receipt=${receipt?.status ?? "missing"}`
          : `review case receipt=${receipt?.status ?? "absent"}`,
    }),
  );

  const ingestionScore = weightedScore([
    { score: cross.ok ? 1 : 0, weight: 0.3 },
    { score: intent.idempotency_key === expectedKey ? 1 : 0, weight: 0.25 },
    { score: operationKinds.length === intentOperationKinds.length ? 1 : 0, weight: 0.2 },
    { score: receiptScore, weight: 0.25 },
  ]);
  const sourceQuality = (citationAccuracy + retrievability) / 2;
  const score = weightedScore([
    { score: groundingScore, weight: 0.3 },
    { score: sourceQuality, weight: 0.2 },
    { score: semanticScore, weight: 0.2 },
    { score: ingestionScore, weight: 0.2 },
    { score: search.score, weight: 0.1 },
  ]);
  return finalizeCase({
    id: row.id,
    suite: "packet",
    score,
    findings,
    metrics: {
      evidence_grounding: groundingScore,
      verified_source_precision: citationAccuracy,
      source_retrievability: retrievability,
      semantic_accuracy: semanticScore,
      ingestion_integrity: ingestionScore,
      search_efficiency: search.score,
      evidence_anchor_count: packet.transcript_analysis.evidence_anchors.length,
      source_count: verifiedResources.length,
      ...Object.fromEntries(
        Object.entries(search.counts).map(([key, value]) => [`searches.${key}`, value]),
      ),
    },
    metadata: { video_id: row.video_id, run_id: row.run_id },
  });
}

export async function evaluatePacketDirectory(
  row: GoldenPacketCase,
  directory = goldenPacketDirectory(row),
): Promise<EvaluationCaseResult> {
  try {
    const { packet, receipt } = await loadPacketDirectory(directory);
    return evaluatePacket(row, packet, receipt);
  } catch (error) {
    return finalizeCase({
      id: row.id,
      suite: "packet",
      score: 0,
      findings: [
        finding({
          name: "packet_load_and_schema",
          score: 0,
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
      metrics: {},
      metadata: { video_id: row.video_id, run_id: row.run_id, directory },
    });
  }
}
