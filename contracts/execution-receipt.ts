import { z } from "zod";
import { PACKET_SCHEMA_VERSION, sha256Schema, V1_PACKET_SCHEMA_VERSION } from "./enums";
import { intentOperationKindSchema } from "./ingestion-intent";

const executionReceiptOperationSchema = z.object({
  operation_index: z.number().int().min(0),
  kind: intentOperationKindSchema,
  status: z.enum(["applied", "skipped", "failed"]),
  affected_table: z.string().nullable(),
  affected_key: z.string().nullable(),
  error_detail: z.string().nullable(),
});

const executionReceiptBaseSchema = z.object({
  intent_id: z.uuid(),
  run_id: z.uuid(),
  video_id: z.string().min(1),
  intent_sha256: sha256Schema,
  status: z.enum(["applied", "rejected", "already_applied"]),
  applied_at: z.iso.datetime().nullable(),
  analysis_id: z.uuid().nullable(),
  operations: z.array(executionReceiptOperationSchema),
  error_code: z.string().nullable(),
  error_detail: z.string().nullable(),
});

export const executionReceiptV1Schema = executionReceiptBaseSchema.extend({
  schema_version: z.literal(V1_PACKET_SCHEMA_VERSION),
});

export const executionReceiptSchema = executionReceiptBaseSchema.extend({
  schema_version: z.literal(PACKET_SCHEMA_VERSION),
  packet_schema_version: z.string().min(1),
  packet_storage_prefix: z.string().min(1),
  finished_marker_written: z.boolean(),
  artifact_count: z.number().int().min(0),
});

export const executionReceiptV2Schema = executionReceiptSchema;
export const executionReceiptAnySchema = z.union([executionReceiptV1Schema, executionReceiptV2Schema]);

export type ExecutionReceiptV1 = z.infer<typeof executionReceiptV1Schema>;
export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;
export type ParsedExecutionReceipt = ExecutionReceiptV1 | ExecutionReceipt;

export function parseExecutionReceipt(json: unknown): ParsedExecutionReceipt {
  const version = z.object({ schema_version: z.string() }).parse(json).schema_version;
  if (version === V1_PACKET_SCHEMA_VERSION) {
    return executionReceiptV1Schema.parse(json);
  }
  if (version === PACKET_SCHEMA_VERSION) {
    return executionReceiptSchema.parse(json);
  }
  throw new Error(`Unsupported execution receipt schema_version: ${version}`);
}
