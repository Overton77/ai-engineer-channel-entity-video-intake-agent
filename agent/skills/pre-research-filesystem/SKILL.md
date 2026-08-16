---
description: Use when starting a pre-research run or writing scratch-pad files. Defines the /workspace layout and v2 packet files for this filesystem agent.
---

# Pre-research filesystem protocol

This agent is a filesystem agent. Think on disk. Do not keep long notes only in chat.

## Root for one video

```
/workspace/pre-research/<video_id>/<run_id>/
```

Create that directory before specialist fan-out.

## v2 packet files

Durable bucket prefix: `research-ingestion-intents/pre-research/v2/<video_id>/<run_id>/`

| File | Writer | Phase | Consumer |
| --- | --- | --- | --- |
| `00-run-manifest.json` | research root | research | all later steps |
| `10-transcript-analysis.json` | transcript_analyst | research | synthesis |
| `20-taxonomy-classification.json` | taxonomy_classifier | research | synthesis |
| `30-web-context.json` | web_context_scout | research | source_verifier, synthesis |
| `35-organization-research.json` | organization_researcher | research | source_verifier, synthesis |
| `40-source-verification.json` | source_verifier | research | synthesis |
| `50-curriculum-signals.json` | curriculum_mapper | research | synthesis |
| `initial-summary/60-initial-summary.json` | synthesis root | synthesis | intent / executor |
| `technology-library-summary/70-technology-library-summary.json` | synthesis root | synthesis | intent / executor |
| `organization-profile/80-organization-profile.json` | synthesis root | synthesis | intent / executor |
| `90-ingestion-intent.json` | synthesis root | synthesis | deterministic executor |
| `99-execution-receipt.json` | executor only | after apply | humans / dispatcher |

Research session writes `00`–`50` and calls `save_research_phase_packet`. It must never write `60`, `70`, `80`, or `90`.

Synthesis session loads the durable `00`–`50` checkpoint with `load_research_phase_packet`, writes `60`–`90`, and calls `save_pre_research_packet`. It must never call research subagents.

`99` is executor-only. Neither Eve session may mark the pipeline finished.

## Scratch files allowed

```
notes/transcript.md
notes/taxonomy.md
notes/search-ledger.md
notes/organization.md
notes/verification.md
notes/curriculum.md
schema/postgres-schema.md
```

## Rules

- Specialists have isolated sandboxes. They cannot see the root workspace unless the parent puts the needed JSON in their `message`.
- Still write files inside the child sandbox. Return the JSON in the specialist result so the root can copy it into the packet directory.
- Never write raw transcript text into packet or intent files.
- Never write SQL files.
- Hosted `/workspace` is ephemeral. Phase save tools upload to `research-ingestion-intents`.
