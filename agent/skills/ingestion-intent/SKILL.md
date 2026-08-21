---
description: Use when synthesizing 90-ingestion-intent.json in the synthesis session. This is the only write contract the model may produce.
---

# Ingestion intent contract

Read `references/operations.md` for payload shapes.

The executor consumes only `90-ingestion-intent.json`. It maps a fixed operation enum to TypeScript/Postgres functions. There is no `execute_sql`.

Research sessions must not produce this file. Synthesis produces `60`, `70`, and `80` first, then `90`.

## Required envelope

```json
{
  "schema_version": "2.0.0",
  "intent_id": "<uuid>",
  "idempotency_key": "<sha256 of canonical source+operations>",
  "source": {
    "video_id": "<youtube id>",
    "run_id": "<run uuid>",
    "transcript_sha256": "<64 hex>",
    "taxonomy_version": "1.0.0",
    "prompt_bundle_version": "pre-research-2.0.0",
    "model_id": "zai/glm-5.2",
    "research_as_of": "<YYYY-MM-DD>",
    "packet_schema_version": "2.0.0"
  },
  "evidence_grades_used": ["said_in_transcript"],
  "operations": []
}
```

## Allowlisted operations, in this order

1. `create_video_analysis`
2. `create_contextualized_initial_summary`
3. `replace_technology_library_summaries`
4. `replace_category_assignments`
5. `replace_domain_assignments`
6. `replace_lifecycle_assignments`
7. `replace_evidence_anchors`
8. `replace_organization_candidates`
9. `replace_organization_sources`
10. `upsert_resource_candidates`
11. `upsert_entity_candidates`
12. `record_web_search_events`

`60`, `70`, and `80` payloads in the intent must match those files in meaning. Organization candidate UUIDs are generated in the intent so organization-source operations can reference them.

## Forbidden

- `{ "kind": "execute_sql" }`
- Unknown kinds
- Unknown category or organization-domain codes
- More than one primary video category
- More than three secondary video categories
- More than one primary featured organization
- More than two secondary organization domains
- Resources with `verification_status: verified` and `is_first_party: true` unless source_verifier agreed
- Raw transcript text
- Writing this file during the research session

## After validation

In the final `ingestion_intent` synthesis stage, call `save_synthesis_stage_packet`. The tool overwrites `idempotency_key` with the canonical hash and validates against registered `00`–`80`. Do not re-read or re-embed the packet to recompute it. Do not mark the pipeline finished.
