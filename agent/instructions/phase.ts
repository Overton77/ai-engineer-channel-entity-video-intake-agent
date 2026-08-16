import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveRunPhase } from "../lib/phase";

function researchAsOfLine(date: string): string {
  return `Research as of ${date}. Compare publication date with research date. Label technology status current | changed_since_publication | historical | uncertain. Do not assume the transcript describes the present.`;
}

function researchPhaseInstructions(input: {
  run_id: string;
  video_id: string;
  research_as_of: string;
  status: string;
}): string {
  return `# Current phase: research

Run \`${input.run_id}\` for video \`${input.video_id}\` (status \`${input.status}\`).
${researchAsOfLine(input.research_as_of)}

Claim and session binding already happened via the controller. Do not claim another video. Do not start synthesis. Do not call a second agent project.

## Skills to load

1. \`pre-research-filesystem\`
2. \`pre-research-schema\`
3. \`pre-research-taxonomy\`
4. \`organization-taxonomy\`

## Order

1. Call \`load_video_context\` and \`load_taxonomy\` for this run's video if the controller message did not already include them.
2. Write \`00-run-manifest.json\` with \`research_as_of\`, packet schema \`2.0.0\`, transcript pointer/hash, and video publish date. No raw transcript text.
3. Wave one — five specialists in one \`Workflow\` program, including \`organization_researcher\`:

\`\`\`js
const shared = <RUN_PLUS_VIDEO_PLUS_TAXONOMY_PLUS_RESEARCH_AS_OF_JSON>;
const [transcript, taxonomy, web, organization, curriculum] = await Promise.all([
  tools.transcript_analyst({ message: shared }),
  tools.taxonomy_classifier({ message: shared }),
  tools.web_context_scout({ message: shared }),
  tools.organization_researcher({ message: shared }),
  tools.curriculum_mapper({ message: shared }),
]);
return JSON.stringify({ transcript, taxonomy, web, organization, curriculum });
\`\`\`

4. Wave two: call \`source_verifier\` with web-context and organization-research candidates. It must use \`web_search\`.
5. Write specialist JSON files \`10\` through \`50\`, including \`35-organization-research.json\`, into \`/workspace/pre-research/<video_id>/<run_id>/\`.
6. Call \`save_research_phase_packet\` with the exact \`00\`–\`50\` objects. The research checkpoint is incomplete until it returns \`saved: true\`.
7. Return a structured research-phase receipt: \`run_id\`, \`video_id\`, artifact paths/hashes, and that research stopped. Do not paste the transcript.

## Hard stop

NEVER write \`60\`, \`70\`, \`80\`, or \`90\`. NEVER call \`save_pre_research_packet\` or \`load_research_phase_packet\`. NEVER start another agent. Trusted controller code verifies registered \`00\`–\`50\` hashes and moves the run to \`research_complete\`.
`;
}

function synthesisPhaseInstructions(input: {
  run_id: string;
  video_id: string;
  research_as_of: string;
  status: string;
}): string {
  return `# Current phase: synthesis

Run \`${input.run_id}\` for video \`${input.video_id}\` (status \`${input.status}\`).
${researchAsOfLine(input.research_as_of)}

This is a fresh root session. Research subagents are unavailable. Do not call \`transcript_analyst\`, \`taxonomy_classifier\`, \`web_context_scout\`, \`organization_researcher\`, \`source_verifier\`, or \`curriculum_mapper\`.

## Skills to load

1. \`pre-research-filesystem\`
2. \`pre-research-schema\`
3. \`pre-research-taxonomy\`
4. \`organization-taxonomy\`
5. \`ingestion-intent\`

## Order

1. Call \`load_research_phase_packet\` with this \`run_id\`. Use only the hash-verified \`00\`–\`50\` artifacts it returns.
2. Produce and validate \`60-initial-summary.json\`, then \`70-technology-library-summary.json\`, then \`80-organization-profile.json\`.
3. Produce \`90-ingestion-intent.json\` from \`10\`–\`80\` using only allowlisted v2 operations.
4. Call \`save_pre_research_packet\` with \`60\`, \`70\`, \`80\`, and \`90\`. The synthesis checkpoint is incomplete until it returns \`saved: true\`.
5. Return a structured synthesis-phase receipt: \`run_id\`, \`video_id\`, primary category, organization domain, artifact paths/hashes, and \`intent_ready\` or \`review_required\`. Do not paste the transcript. Do not claim the pipeline is finished.

## Hard stop

Never call research subagents. Never rewrite \`00\`–\`50\`. Never mark finished. Only the deterministic executor/finalizer can set \`pre_research_pipeline_finished\`.
`;
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const resolved = await resolveRunPhase(ctx);
      if (!resolved) return null;

      const content =
        resolved.phase === "research"
          ? researchPhaseInstructions({
              run_id: resolved.run.run_id,
              video_id: resolved.run.video_id,
              research_as_of: resolved.research_as_of,
              status: resolved.run.status,
            })
          : synthesisPhaseInstructions({
              run_id: resolved.run.run_id,
              video_id: resolved.run.video_id,
              research_as_of: resolved.research_as_of,
              status: resolved.run.status,
            });

      return defineInstructions({ content });
    },
  },
});
