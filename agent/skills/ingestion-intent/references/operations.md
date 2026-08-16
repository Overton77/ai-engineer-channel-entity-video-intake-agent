# Allowlisted intent operations

See `contracts/ingestion-intent.ts` for the Zod source of truth. Packet schema `2.0.0`. Prompt bundle `pre-research-2.0.0`.

Apply only in this order:

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

## create_video_analysis

Payload fields: `initial_summary` (75–125 words), `structured_summary` (200–400 words), `contextualized_abstract`, `why_it_matters`, `key_takeaways` (5–10), `concepts`, `prerequisites`, `learning_outcomes`, `limitations`, `quantitative_claims`, `demonstrations`, `curriculum_roles`, `challenge_seeds`, `difficulty`, `content_form`, `evidence_level`, `overall_confidence`.

`initial_summary` must be transcript-only.

## create_contextualized_initial_summary

Must match `60-initial-summary.json`: transcript summary, structured software-engineering and AI concepts, why they matter together, separately labeled external notes, temporal context vs `research_as_of`, evidence ids/grades, and an explicit transcript-vs-web disagreement note when needed.

## replace_technology_library_summaries

Must match `70-technology-library-summary.json`. Zero or more ranked families. Separate the technology/method from implementations. Empty `families` plus `no_main_technology_reason` is valid.

## replace_category_assignments

Array of `{ category_code, assignment_role, confidence, rationale, alternative_rank }`.
Exactly one `primary`. ≤3 `secondary`.

## replace_domain_assignments

Array of `{ domain_code, confidence, rationale }`. `domain_code` must exist in `research_application_domain`.

## replace_lifecycle_assignments

Array of lifecycle stage enums.

## replace_evidence_anchors

Array of anchors with `evidence_id` UUIDs. Resources, entities, summaries, and organization rows reference these ids.

## replace_organization_candidates

Must match `80-organization-profile.json` candidates. Exactly one `is_primary_featured` / `featured_rank = 1`. One primary organization-domain code and at most two secondary codes. Parent and speaker employer are separate facts.

## replace_organization_sources

Ranked sources for those candidate UUIDs. Primary featured organization needs at least two verified, publicly retrievable authoritative sources: one identity/ownership and one implementation-specific technical source.

## upsert_resource_candidates / upsert_entity_candidates

Must include `verification_status` and `evidence_ids`.

## record_web_search_events

Provider must be `exa`. Subagent must be `organization_researcher`, `web_context_scout`, or `source_verifier`.
