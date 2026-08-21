---
description: Use when starting a pre-research run or writing scratch-pad files. Defines the /workspace layout and v2 packet files for this filesystem agent.
---

# Pre-research artifact protocol

The phase save tools materialize validated objects to host outputs and Supabase Storage. Sandbox/file tools are disabled in the default pipeline to avoid provisioning per-session compute.

## Root for one video

```
/workspace/pre-research/<video_id>/<run_id>/
```

Treat this as the logical packet directory. Do not create it with sandbox tools; the save tool creates the host output path and uploads the packet objects.

## v2 packet files

Durable bucket prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`

| File | Writer | Phase | Consumer |
| --- | --- | --- | --- |
| `00-run-manifest.json` | research root | research | all later steps |
| `10-transcript-analysis.json` | iterative transcript tool + research root | research | synthesis |
| `20-taxonomy-classification.json` | research root | research | synthesis |
| `30-web-context.json` | research root | research | verification, synthesis |
| `35-organization-research.json` | research root | research | verification, synthesis |
| `40-source-verification.json` | research root | research | synthesis |
| `50-curriculum-signals.json` | research root | research | synthesis |
| `initial-summary/60-initial-summary.json` | synthesis root | synthesis | intent / executor |
| `technology-library-summary/70-technology-library-summary.json` | synthesis root | synthesis | intent / executor |
| `organization-profile/80-organization-profile.json` | synthesis root | synthesis | intent / executor |
| `90-ingestion-intent.json` | synthesis root | synthesis | deterministic executor |
| `99-execution-receipt.json` | executor only | after apply | humans / dispatcher |

Research prepares `00`–`50` in bounded stages and calls `save_research_stage_packet` for only the current stage. It must never create `60`, `70`, `80`, or `90`.

Synthesis loads the minimum durable checkpoint for the current bounded stage with `load_research_phase_packet`, prepares exactly one of `60`, `70`, `80`, or `90`, and calls `save_synthesis_stage_packet`. The controller clears model history between registered stages. Do not use sandbox/file tools, skill loading, or validation loops.

`99` is executor-only. Neither Eve session may mark the pipeline finished.

## Rules

- The default pipeline has no subagent fan-out. Produce research artifacts sequentially in the research root context.
- `load_video_context` returns metadata plus a bounded iterative transcript analysis, never the raw transcript. Pass its `transcript_analysis` as `10-transcript-analysis.json` unchanged.
- Never write raw transcript text into packet or intent files.
- Never write SQL files.
- Phase save tools upload to `research-ingestion-intents` and write host-side `outputs/pre-research/` copies.
