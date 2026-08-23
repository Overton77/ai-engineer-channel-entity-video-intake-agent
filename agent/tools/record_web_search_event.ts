import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { query } from "../lib/postgres";
import { researchStageFromMessages } from "../lib/turn-capabilities";
import {
  webSearchLedgerCap,
  webSearchLedgerLabelForStage,
} from "../lib/web-search-budget";

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      const subagent = webSearchLedgerLabelForStage(researchStageFromMessages(ctx.messages));
      if (!subagent) return null;
      const cap = webSearchLedgerCap(subagent);
      return defineTool({
        description: `Append one Exa web_search ledger row for the current run. The active stage label is enforced as ${subagent}; at most ${cap} distinct queries can be recorded for this stage.`,
        inputSchema: z.object({
          run_id: z.uuid(),
          query: z.string().min(1),
          search_purpose: z.string().min(1),
          result_urls: z.array(z.url()).default([]),
          selected_urls: z.array(z.url()).default([]),
        }),
        async execute(input) {
          const rows = await query<{
            search_event_id: string | null;
            duplicate: boolean;
            event_count: number;
          }>(
            `with lock as materialized (
               select pg_advisory_xact_lock(
                 hashtextextended('pre-research-web-search:' || $1::text || ':' || $2::text, 0)
               )
             ), state as materialized (
               select
                 count(existing.search_event_id)::int as event_count,
                 coalesce(bool_or(existing.query = $3), false) as duplicate
               from lock
               left join public.research_web_search_event existing
                 on existing.run_id = $1::uuid
                and existing.subagent = $2
             ), inserted as (
               insert into public.research_web_search_event (
                 run_id, subagent, query, provider, result_urls, selected_urls, search_purpose
               )
               select $1::uuid, $2, $3, 'exa', $4::jsonb, $5::jsonb, $6
               from state
               where not duplicate and event_count < $7
               returning search_event_id
             )
             select
               inserted.search_event_id,
               state.duplicate,
               state.event_count
             from state
             left join inserted on true`,
            [
              input.run_id,
              subagent,
              input.query,
              JSON.stringify(input.result_urls),
              JSON.stringify(input.selected_urls),
              input.search_purpose,
              cap,
            ],
          );
          const row = rows[0];
          if (row?.duplicate) {
            return { recorded: true as const, duplicate: true as const, search_event_id: null };
          }
          if (!row?.search_event_id) {
            return {
              recorded: false as const,
              cap_reached: true as const,
              cap,
              search_event_id: null,
            };
          }
          return {
            recorded: true as const,
            duplicate: false as const,
            search_event_id: row.search_event_id,
          };
        },
      });
    },
  },
});
