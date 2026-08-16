---
description: Use when classifying a video into the official AI engineering category spine or choosing application domains.
---

# Official taxonomy v1.0.0

Use the taxonomy JSON from the parent message. Do not invent category codes.

Pick exactly one primary. Up to three secondary. If two primaries seem equally good, choose one and put the other in `alternative`.

Tie-breakers:

- Coding-agent product > general agent architecture
- Durable workflow engine > in-memory agent loop
- RAG/index design > generic data pipelines
- Offline eval methodology > production tracing
- Model-intrinsic alignment > product safety UX

Application domains must come from the loaded lookup table, including `general_purpose`.

Organization-domain codes (`research_organization_domain_code`) are a separate taxonomy. Do not assign them here. The `organization_researcher` and synthesis session use the `organization-taxonomy` skill.
