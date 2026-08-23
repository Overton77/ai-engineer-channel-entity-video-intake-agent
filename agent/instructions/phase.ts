import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveRunPhase, type ResearchStage } from "../lib/phase";

function researchAsOfLine(date: string): string {
  return `Research as of ${date}. Compare publication date with research date. Label technology status current | changed_since_publication | historical | uncertain. Do not assume the transcript describes the present.`;
}

function researchPhaseInstructions(input: {
  run_id: string;
  video_id: string;
  research_as_of: string;
  status: string;
  research_stage: ResearchStage | null;
}): string {
  const stage = input.research_stage;
  const stageOrder =
    stage === null
      ? "Read the current controller delivery for its explicit bounded research stage and perform only that stage. Do not infer transcript_taxonomy merely because earlier artifacts appear in PRIOR_RESEARCH_CONTEXT_JSON."
      : stage === "transcript_taxonomy"
      ? `This turn is ONLY stage \`transcript_taxonomy\`. Use PRECOMPUTED_VIDEO_CONTEXT_JSON, do not call \`web_search\`, call \`load_taxonomy\` once, prepare 00/10/20, then call \`save_research_stage_packet\` with stage \`transcript_taxonomy\` and stop.`
      : stage === "web_context"
        ? `This turn is ONLY stage \`web_context\`. Use PRIOR_RESEARCH_CONTEXT_JSON. Make at most 3 high-value searches, prepare 30, call \`save_research_stage_packet\` with stage \`web_context\`, and stop.`
        : stage === "organization_research"
          ? `This turn is ONLY stage \`organization_research\`. Use PRIOR_RESEARCH_CONTEXT_JSON. Make at most 3 first-party-focused searches, prepare 35, call \`save_research_stage_packet\` with stage \`organization_research\`, and stop.`
          : stage === "source_verification"
            ? `This turn is ONLY stage \`source_verification\`. Use PRIOR_RESEARCH_CONTEXT_JSON. Make at most 2 gap-filling searches, prepare 40, call \`save_research_stage_packet\` with stage \`source_verification\`, and stop.`
            : `This turn is ONLY stage \`curriculum\`. Use PRIOR_RESEARCH_CONTEXT_JSON, do not call \`web_search\`, prepare 50, then call \`save_research_stage_packet\` with stage \`curriculum\` and stop.`;
  return `# Current phase: research

Run \`${input.run_id}\` for video \`${input.video_id}\` (status \`${input.status}\`).
${researchAsOfLine(input.research_as_of)}

## Mandatory bounded stage

${stageOrder}
Do not prepare or save artifacts belonging to any other stage in this turn. The controller clears conversation history between stages while preserving this session identity.

Claim and session binding already happened via the controller. Do not claim another video. Do not start synthesis. Do not call a second agent project.

## Skills to load

1. \`pre-research-filesystem\`
2. \`pre-research-schema\`
3. \`pre-research-taxonomy\`
4. \`organization-taxonomy\`

## Order

1. The trusted controller splits every transcript into bounded sections, passes the cumulative summary from each GLM 5.2 call into the next, and includes the resulting compact \`PRECOMPUTED_VIDEO_CONTEXT_JSON\` in the initial message. Use it as source data and do not call \`load_video_context\`; keeping those long model calls outside Eve prevents workflow redelivery and stream-file amplification. If needed, call \`load_pre_research_run\` with this \`run_id\`, then call \`load_taxonomy\`. Do not call \`claim_pre_research_video\`, \`touch_pre_research_run\`, or \`ask_question\` for run metadata.
2. Work in this root session only. Subagents and \`Workflow\` are intentionally disabled by default to avoid separate sessions, streams, and sandboxes. Do not attempt to call them.
3. In transcript_taxonomy only, prepare \`00-run-manifest.json\` with \`research_as_of\`, packet schema \`2.0.0\`, transcript pointer/hash, and video publish date. Keep the returned \`transcript_analysis\` unchanged as the \`10-transcript-analysis.json\` object. No raw transcript text.
4. Using the transcript analysis, video description, and loaded taxonomy, prepare \`20-taxonomy-classification.json\` with exactly one primary category and grounded domain/lifecycle/difficulty/form/evidence assignments.
5. In the applicable bounded stage only, use \`web_search\` within the stated query cap and reuse PRIOR_RESEARCH_CONTEXT_JSON. Prefer first-party sources and verify the narrowest implementation-owning organization, ownership, current status, and authoritative-source minimum. After each search, call \`record_web_search_event\`; the tool derives and enforces the ledger label from the active stage.
6. Every \`evidence_ids\` value must be copied verbatim from the registered \`transcript_analysis.evidence_anchors\` supplied in current prior context. Never fabricate or reshape UUIDs; omit an unsupported optional reference.
6. Prepare \`50-curriculum-signals.json\` from the transcript analysis and taxonomy. These are signals, not a finished course.
7. Do not call sandbox/file tools. Call \`save_research_stage_packet\` exactly once with only the current stage objects; the tool materializes host and Supabase files. If validation fails, fix only the reported fields and retry.
8. Return a structured research-phase receipt: \`run_id\`, \`video_id\`, transcript chunk count, artifact paths/hashes, and that research stopped. Do not paste the transcript or artifact bodies.

## Hard stop

NEVER create \`60\`, \`70\`, \`80\`, or \`90\`. NEVER call \`save_synthesis_stage_packet\` or \`load_research_phase_packet\`. NEVER start another agent. Trusted controller code verifies registered \`00\`–\`50\` hashes and moves the run to \`research_complete\`.
`;
}

function synthesisPhaseInstructions(input: {
  run_id: string;
  video_id: string;
  research_as_of: string;
  status: string;
  synthesis_stage: string | null;
}): string {
  return `# Current phase: synthesis

Run \`${input.run_id}\` for video \`${input.video_id}\` (status \`${input.status}\`).
${researchAsOfLine(input.research_as_of)}

This is a fresh root session. Research subagents are unavailable. Do not call \`transcript_analyst\`, \`taxonomy_classifier\`, \`web_context_scout\`, \`organization_researcher\`, \`source_verifier\`, or \`curriculum_mapper\`.

## Order

Current bounded synthesis stage: \`${input.synthesis_stage ?? "controller_message_stage"}\`.

1. Do not load skills or taxonomy separately. Call \`load_research_phase_packet\` once; it returns the minimum hash-verified context for this stage plus prior synthesis checkpoints.
2. Prepare only the artifact named by the current stage and call \`save_synthesis_stage_packet\` once. Do not prepare later artifacts in context.
3. In the \`ingestion_intent\` stage only, put any 64-hex placeholder in \`idempotency_key\`; the save tool overwrites it.
4. Do not paste artifact bodies back into the conversation. Return a compact stage receipt with the path/hash and stop.

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
              research_stage: resolved.research_stage,
            })
          : synthesisPhaseInstructions({
              run_id: resolved.run.run_id,
              video_id: resolved.run.video_id,
              research_as_of: resolved.research_as_of,
              status: resolved.run.status,
              synthesis_stage: resolved.synthesis_stage,
            });

      return defineInstructions({ content });
    },
  },
});
