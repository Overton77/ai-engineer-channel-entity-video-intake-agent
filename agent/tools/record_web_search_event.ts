import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { webSearchSubagentSchema } from "../../contracts/ingestion-intent";
import { query } from "../lib/postgres";
import { researchStageFromMessages } from "../lib/turn-capabilities";

const recordWebSearchEvent = defineTool({
  description:
    "Append one Exa web_search ledger row for the current run. The root uses the logical stage labels organization_researcher, web_context_scout, and source_verifier after every web_search.",
  inputSchema: z.object({
    run_id: z.uuid(),
    subagent: webSearchSubagentSchema,
    query: z.string().min(1),
    search_purpose: z.string().min(1),
    result_urls: z.array(z.url()).default([]),
    selected_urls: z.array(z.url()).default([]),
  }),
  async execute(input) {
    const rows = await query<{ search_event_id: string }>(
      `insert into public.research_web_search_event (
         run_id, subagent, query, provider, result_urls, selected_urls, search_purpose
       ) values ($1, $2, $3, 'exa', $4::jsonb, $5::jsonb, $6)
       returning search_event_id`,
      [
        input.run_id,
        input.subagent,
        input.query,
        JSON.stringify(input.result_urls),
        JSON.stringify(input.selected_urls),
        input.search_purpose,
      ],
    );
    return { recorded: true as const, search_event_id: rows[0]?.search_event_id ?? null };
  },
});

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) =>
      researchStageFromMessages(ctx.messages) ? recordWebSearchEvent : null,
  },
});
