---
description: Use when identifying the featured organization/unit or assigning research_organization_domain_code. Separate from the video engineering-category spine.
---

# Organization taxonomy

Load `references/organization-domains.md` for the full enum, inclusion rules, examples, source hierarchy, and attribution precedence.

This taxonomy classifies an organization or organization unit by its primary role in the AI-engineering value chain. It is not the topic of one video and not a conventional industry vertical.

Use `research_engineering_category_code` for the video's technical subject and `research_application_domain` for the application vertical. Do not duplicate those meanings here.

## Hard rules

- Assign exactly one primary organization-domain code and at most two secondary codes to the primary featured organization.
- Prefer the narrowest authoritative organization that owns or builds the discussed implementation.
- Keep organization, parent organization, speaker affiliation, and featured product/implementation as separate facts.
- A product name alone is not an organization.
- `other_unknown` is allowed so the model never forces a false classification, but it always routes the run to review.

## Primary-domain tie-breaker

1. Official mission and defining product of the narrowest featured organization/unit.
2. The role for which that unit is best known and structurally built, using first-party evidence.
3. The implementation directly owned by the unit in this video.
4. If two durable roles remain, select the more specific code as primary and retain the other as secondary with evidence.
5. Never let a one-off talk topic override the organization's durable role.
