import { defineTool } from "eve/tools";
import { z } from "zod";
import { query } from "../lib/postgres";

const runStatusSchema = z.enum([
  "queued",
  "claimed",
  "analyzing",
  "intent_ready",
  "applying",
  "applied",
  "review_required",
  "failed",
  "superseded",
]);

export default defineTool({
  description:
    "Extend the claim lease and optionally update research_pre_research_run status. Requires the lease_token from claim_pre_research_video. Use analyzing after claim, intent_ready after save_pre_research_intent, failed on unrecoverable errors, review_required when overall_confidence < 0.70.",
  inputSchema: z.object({
    run_id: z.uuid(),
    lease_token: z.uuid(),
    status: runStatusSchema.optional(),
    lease_seconds: z.number().int().min(60).max(21600).default(1800),
    intent_path: z.string().min(1).optional(),
    intent_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    error_code: z.string().min(1).optional(),
    error_detail: z.string().min(1).optional(),
  }),
  async execute(input) {
    const rows = await query<{ run: unknown }>(
      `select to_jsonb(research_private.touch_pre_research_run($1, $2, $3::public.research_pre_research_run_status, $4, $5, $6, $7, $8, $9)) as run`,
      [
        input.run_id,
        input.lease_token,
        input.status ?? null,
        input.lease_seconds,
        null,
        input.intent_path ?? null,
        input.intent_sha256 ?? null,
        input.error_code ?? null,
        input.error_detail ?? null,
      ],
    );
    return { updated: true as const, run: rows[0]?.run ?? null };
  },
});
