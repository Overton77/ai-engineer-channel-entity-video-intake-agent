import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { maxStagesPerInvocation } from "../controller/pre-research-pipeline";
import { PRE_RESEARCH_STAGES, settleAmbiguousLedgerWrite } from "../controller/stages/ledger";
import {
  balancedJsonObjectCandidates,
  classifyError,
  extractJson,
  extractSearchReceipts,
  hydrateTaxonomyOutput,
  hydrateOrganizationResearch,
  hydrateSourceVerification,
  hydrateWebContext,
  maxStageAttempts,
  organizationResearchOutputSchema,
  structuredCandidateValues,
  structuredResponseCandidates,
  sourceSupportsPrimaryOrganization,
  taxonomyOutputSchema,
  webContextOutputSchema,
} from "../controller/stages/stage-runner";

describe("stateless pre-research topology", () => {
  it("keeps the nine canonical application stages in order", () => {
    assert.deepEqual(PRE_RESEARCH_STAGES, [
      "transcript_taxonomy",
      "web_context",
      "organization_research",
      "source_verification",
      "curriculum",
      "initial_summary",
      "technology_library_summary",
      "organization_profile",
      "ingestion_intent",
    ]);
  });

  it("bounds each invocation to one through three stages", () => {
    assert.equal(maxStagesPerInvocation(undefined), 1);
    assert.equal(maxStagesPerInvocation("1"), 1);
    assert.equal(maxStagesPerInvocation("3"), 3);
    for (const value of ["0", "4", "1.5", "nope"]) {
      assert.throws(() => maxStagesPerInvocation(value), /between 1 and 3/);
    }
  });

  it("settles an ambiguously acknowledged stage-park write without waiting for lease expiry", async () => {
    let writes = 0;
    let verifies = 0;
    await settleAmbiguousLedgerWrite({
      write: async () => {
        writes += 1;
        if (writes === 1) throw new Error("read ECONNRESET");
        throw new Error("STAGE_LEASE_INVALID");
      },
      verify: async () => {
        verifies += 1;
        return verifies === 2;
      },
      retryDelayMs: 0,
      wait: async () => undefined,
    });
    assert.equal(writes, 2);
    assert.equal(verifies, 2);
  });

  it("repairs common model JSON formatting defects before schema validation", () => {
    assert.deepEqual(
      extractJson('```json\n{"items":[{"id":"a"} {"id":"b"}],"ok":true}\n```'),
      { items: [{ id: "a" }, { id: "b" }], ok: true },
    );
  });

  it("locally recovers structured candidates from alternate SDK response channels", () => {
    assert.deepEqual(
      structuredResponseCandidates({
        text: "No final object was emitted.",
        reasoningText: '{"ok":true}',
        steps: [
          { text: "intermediate", reasoningText: '{"draft":true}' },
          { text: "No final object was emitted.", reasoningText: '{"ok":true}' },
        ],
      }),
      ["No final object was emitted.", '{"ok":true}', "intermediate", '{"draft":true}'],
    );
  });

  it("locally unwraps an unambiguous singleton structured-object array", () => {
    assert.deepEqual(structuredCandidateValues('[{"ok":true}]'), [[{ ok: true }], { ok: true }]);
    assert.deepEqual(structuredCandidateValues('[{"one":1},{"two":2}]'), [[{ one: 1 }, { two: 2 }]]);
  });

  it("extracts complete balanced objects without splitting on braces inside strings", () => {
    assert.deepEqual(
      balancedJsonObjectCandidates('prefix {"note":"literal } and \\\"quote\\\"","nested":{"ok":true}}, {"second":2} suffix'),
      ['{"note":"literal } and \\\"quote\\\"","nested":{"ok":true}}', '{"second":2}'],
    );
  });

  it("accepts the slim GLM taxonomy shape and hydrates strict packet defaults", () => {
    const slim = taxonomyOutputSchema.parse({
      primary: "ai_product_ux_human_factors",
      secondary: ["ai_platforms_developer_tooling"],
      domains: ["developer tooling"],
      rationale: "The talk explains interface abstractions for builders.",
      lifecycle_stages: ["ops"],
      difficulty: "intro",
      content_form: "talks",
      evidence_level: "case",
    });
    const hydrated = hydrateTaxonomyOutput(slim);
    assert.equal(hydrated.primary.category_code, "ai_product_ux_human_factors");
    assert.equal(hydrated.secondary[0]?.confidence, 0.65);
    assert.equal(hydrated.domains[0]?.domain_code, "developer_platforms");
    assert.deepEqual(hydrated.lifecycle_stages, ["operations"]);
    assert.equal(hydrated.difficulty, "introductory");
    assert.equal(hydrated.content_form, "talk");
    assert.equal(hydrated.evidence_level, "case_study");
  });

  it("hydrates an omitted or empty model lifecycle list to a strict packet default", () => {
    const hydrated = hydrateTaxonomyOutput(taxonomyOutputSchema.parse({
      primary: "ai_platforms_developer_tooling",
      domains: ["developer_platforms"],
      lifecycle_stages: [],
    }));
    assert.deepEqual(hydrated.lifecycle_stages, ["implementation"]);
  });

  it("normalizes object-shaped GLM taxonomy rationale without a stage retry", () => {
    const parsed = taxonomyOutputSchema.parse({
      primary: "ai_platforms_developer_tooling",
      domains: ["developer_platforms"],
      rationale: { summary: "The talk focuses on developer tooling." },
    });
    assert.equal(parsed.rationale, "The talk focuses on developer tooling.");
  });

  it("normalizes object-shaped GLM taxonomy enum wrappers without a stage retry", () => {
    const parsed = taxonomyOutputSchema.parse({
      primary: "ai_platforms_developer_tooling",
      domains: ["developer_platforms"],
      lifecycle_stages: [
        { stage: "evaluation", rationale: "The talk presents an eval loop." },
        { lifecycle_stage: "deployment" },
      ],
      evidence_level: { level: "case_study", rationale: "Production examples are included." },
      difficulty: { difficulty: "advanced" },
      content_form: { form: "talk" },
    });
    assert.deepEqual(parsed.lifecycle_stages, ["evaluation", "deployment"]);
    assert.equal(parsed.evidence_level, "case_study");
    assert.equal(parsed.difficulty, "advanced");
    assert.equal(parsed.content_form, "talk");
  });

  it("bounds slim model generation and search payload budgets without forcing prose-validation fallbacks", async () => {
    const runner = await readFile(new URL("../controller/stages/stage-runner.ts", import.meta.url), "utf8");
    assert.match(runner, /RESEARCH_MAX_OUTPUT_TOKENS = 4_500/);
    assert.match(runner, /STRUCTURED_MAX_OUTPUT_TOKENS = 14_000/);
    assert.match(runner, /numResults: 4/);
    assert.match(runner, /maxCharacters: 1_200/);
    assert.doesNotMatch(runner, /maxOutputTokens: 16_000/);
    assert.doesNotMatch(runner, /Output\.object/);
    assert.doesNotMatch(runner, /const fallback = await generateText/);
  });

  it("does not ask GLM to reconstruct controller-owned searches or organization graphs", () => {
    assert.deepEqual(Object.keys(webContextOutputSchema.shape).sort(), ["entities", "resources"]);
    const orgKeys = Object.keys(organizationResearchOutputSchema.shape);
    assert.ok(orgKeys.includes("candidate_names"));
    assert.ok(!orgKeys.includes("searches"));
    assert.ok(!orgKeys.includes("proposed_sources"));
  });

  it("records actual Exa tool calls as controller receipts", () => {
    const receipts = extractSearchReceipts({
      steps: [{
        toolCalls: [{ toolName: "web_search", toolCallId: "call-1", input: { query: "Amelia Wattenberger official" } }],
        toolResults: [{ toolCallId: "call-1", output: { results: [{ url: "https://example.com/official" }] } }],
      }],
    }, "Find first-party sources");
    assert.deepEqual(receipts, [{
      query: "Amelia Wattenberger official",
      provider: "exa",
      purpose: "Find first-party sources",
      result_urls: ["https://example.com/official"],
    }]);
  });

  it("strips sentence punctuation from search-result and model URLs", () => {
    const receipts = extractSearchReceipts({
      steps: [{
        toolCalls: [{ toolName: "web_search", toolCallId: "call-1", input: { query: "EyeLevel docs" } }],
        toolResults: [{
          toolCallId: "call-1",
          output: { text: "First-party indexes: https://docs.eyelevel.ai/llms.txt. https://docs.eyelevel.ai/llms-full.txt." },
        }],
      }],
    }, "Find first-party sources");
    assert.deepEqual(receipts[0]?.result_urls, [
      "https://docs.eyelevel.ai/llms.txt",
      "https://docs.eyelevel.ai/llms-full.txt",
    ]);

    const parsed = webContextOutputSchema.parse({
      resources: [{
        resource_type: "documentation",
        title: "EyeLevel LLM index",
        url: "https://docs.eyelevel.ai/llms.txt.",
        relationship_to_video: "Official documentation.",
        why_valuable: "Documents the implementation.",
        claimed_first_party: true,
      }],
      entities: [],
    });
    assert.equal(parsed.resources[0]?.url, "https://docs.eyelevel.ai/llms.txt");
  });

  it("hydrates empty model web arrays from actual first-party search results", () => {
    const hydrated = hydrateWebContext(
      { resources: [], entities: [{
        entity_kind: "other",
        name: "Supabase",
        canonical_url: "https://supabase.com/",
        relationship_to_video: "Company featured in the talk.",
      }] },
      [{
        query: "Supabase vector official",
        provider: "exa",
        purpose: "Verify named systems",
        result_urls: ["https://supabase.com/docs/guides/ai/engineering-for-scale"],
      }],
      "2026-08-25",
      { artifacts: { transcript_analysis: { initial_summary: "Supabase presents its vector platform." } } },
    );
    assert.equal(hydrated.resources[0]?.claimed_first_party, true);
    assert.equal(hydrated.entities[0]?.entity_kind, "organization");
    assert.equal(hydrated.entities[0]?.name, "Supabase");

    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({}),
      { artifacts: { web_context: hydrated, transcript_analysis: { evidence_anchors: [] } } },
      [],
      { run_id: "00000000-0000-4000-8000-000000000001", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Supabase");
    assert.equal(organization.review_required, false);
  });

  it("does not turn a deep research-paper result into an organization homepage", () => {
    const hydrated = hydrateWebContext(
      { resources: [], entities: [] },
      [{
        query: "Hidden Technical Debt NIPS paper",
        provider: "exa",
        purpose: "Verify a paper referenced by the speaker",
        result_urls: ["https://papers.nips.cc/paper/2015/file/example-Paper.pdf"],
      }],
      "2026-08-25",
      { artifacts: { transcript_analysis: { initial_summary: "The speaker cites a 2015 NIPS paper." } } },
    );
    assert.equal(hydrated.entities.some((entity) => entity.name === "Nips"), false);
    assert.equal(hydrated.resources.some((resource) => resource.url === "https://papers.nips.cc/"), false);
  });

  it("keeps unrelated verified web resources out of primary organization sources", () => {
    const primary = {
      canonical_name: "Mastercard",
      normalized_name: "mastercard",
      official_url: "https://mastercard.com/",
    };
    assert.equal(sourceSupportsPrimaryOrganization({
      url: "https://www.mastercard.com/global/en/business/artificial-intelligence.html",
      title: "Artificial intelligence at Mastercard",
    }, primary), true);
    assert.equal(sourceSupportsPrimaryOrganization({
      url: "https://papers.nips.cc/paper/2015/file/example-Paper.pdf",
      title: "Hidden Technical Debt in Machine Learning Systems",
      claim_supported: "The talk cites this NIPS paper as background.",
    }, primary), false);
  });

  it("does not promote the Exa search provider when ordinary words merely contain exa", () => {
    const transcriptAnalysis = {
      initial_summary: "This is an example of parameter-efficient fine-tuning and model evaluation.",
      evidence_anchors: [],
    };
    const hydrated = hydrateWebContext(
      {
        resources: [{
          resource_type: "paper",
          title: "QLoRA publication mirror",
          url: "https://exa.ai/library/publication/example",
          publisher: "exa.ai",
          relationship_to_video: "Supporting paper.",
          why_valuable: "Provides paper metadata.",
          claimed_first_party: true,
        }],
        entities: [{
          entity_kind: "organization",
          name: "Exa",
          canonical_url: "https://exa.ai/",
          relationship_to_video: "Search provider result.",
        }],
      },
      [{
        query: "QLoRA paper",
        provider: "exa",
        purpose: "Find current context",
        result_urls: ["https://exa.ai/library/publication/example"],
      }],
      "2026-08-25",
      { artifacts: { transcript_analysis: transcriptAnalysis } },
    );
    assert.equal(hydrated.resources[0]?.claimed_first_party, false);
    assert.equal(hydrated.entities.some((entity) => entity.name === "Exa"), false);

    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Exa",
          canonical_url: "https://exa.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      { artifacts: { web_context: hydrated, transcript_analysis: transcriptAnalysis } },
      [],
      { run_id: "00000000-0000-4000-8000-000000000003", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates.length, 0);
    assert.equal(organization.review_required, true);
  });

  it("still permits Exa when the transcript names Exa as the subject", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Exa",
          canonical_url: "https://exa.ai/",
          primary_domain_code: "ai_developer_platform_sdk",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: { initial_summary: "Exa presents its neural search platform.", evidence_anchors: [] },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000004", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Exa");
    assert.equal(organization.review_required, false);
  });

  it("uses organization-stage search receipts for nonstandard official domains", () => {
    const receipts = [{
      query: '"New Computer" startup Sam Whitmore Jason Yuan',
      provider: "exa" as const,
      purpose: "Identify the implementation-owning organization",
      result_urls: ["https://exa.ai/library/organization/example", "https://getdot.ai/"],
    }];
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({}),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: { initial_summary: "Sam Whitmore and Jason Yuan present New Computer and its Dot product.", evidence_anchors: [] },
        },
      },
      receipts,
      { run_id: "00000000-0000-4000-8000-000000000002", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "New Computer");
    assert.equal(organization.candidates[0]?.official_url, "https://getdot.ai/");
    const verification = hydrateSourceVerification(
      { resources: [], entities: [] },
      { artifacts: { web_context: { resources: [], entities: [] }, organization_research: organization } },
      "2026-08-25",
    );
    assert.equal(verification.resources[0]?.source_role, "official_homepage");
    assert.equal(verification.resources[0]?.verification_status, "verified");
  });

  it("recovers an omitted organization from transcript-anchored GitHub and official-doc results", () => {
    const receipts = [{
      query: "Guardrails AI company GitHub organization guardrails-ai who owns the framework",
      provider: "exa" as const,
      purpose: "Identify the implementation-owning organization",
      result_urls: [
        "https://github.com/guardrails-ai",
        "https://github.com/guardrails-ai/guardrails",
        "https://www.guardrailsai.com/docs",
      ],
    }];
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({}),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Shreya Rajpal presents Guardrails AI and its validation framework.",
            evidence_anchors: [],
          },
        },
      },
      receipts,
      { run_id: "00000000-0000-4000-8000-000000000005", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Guardrails AI");
    assert.equal(organization.candidates[0]?.official_url, "https://guardrailsai.com/");
    assert.equal(organization.review_required, false);
    assert.ok(organization.proposed_sources.some((source) => source.url === "https://www.guardrailsai.com/docs"));
    const verification = hydrateSourceVerification(
      { resources: [], entities: [] },
      { artifacts: { web_context: { resources: [], entities: [] }, organization_research: organization } },
      "2026-08-25",
    );
    assert.ok(verification.resources.some((source) => source.source_role === "official_documentation"));
  });

  it("rejects a generic event publisher and recovers the speaker's implementation-owning company", () => {
    const receipts = [{
      query: "Lukas Biewald Weights & Biases Weave evaluation tool",
      provider: "exa" as const,
      purpose: "Identify the implementation-owning organization",
      result_urls: [
        "https://wandb.ai/site/weave/",
        "https://docs.wandb.ai/weave",
      ],
    }, {
      query: "AI Engineer World's Fair 2024 conference organizer publisher",
      provider: "exa" as const,
      purpose: "Identify the implementation-owning organization",
      result_urls: ["https://www.ai.engineer/worldsfair/2024", "https://www.ai.engineer/about"],
    }];
    const hydratedWeb = hydrateWebContext(
      {
        resources: [],
        entities: [{
          entity_kind: "organization",
          name: "AI",
          canonical_url: "https://ai.engineer/",
          relationship_to_video: "Conference publisher.",
        }],
      },
      [receipts[1]!],
      "2026-08-25",
      { artifacts: { transcript_analysis: {
        initial_summary: "AI systems are discussed at the AI Engineer World's Fair.",
      } } },
    );
    assert.ok(!hydratedWeb.entities.some((entity) => entity.name.toLowerCase() === "ai"));
    assert.ok(!hydratedWeb.resources.some((resource) =>
      resource.url.includes("ai.engineer") && resource.claimed_first_party));

    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "AI",
          canonical_url: "https://ai.engineer/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: hydratedWeb,
          transcript_analysis: {
            initial_summary: "Lukas Biewald discusses productionizing GenAI models.",
            structured_summary: "Lukas Biewald, founder of Weights & Biases, addresses production evaluation and presents W&B Weave.",
            evidence_anchors: [],
          },
        },
      },
      receipts,
      { run_id: "00000000-0000-4000-8000-000000000006", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Weights & Biases");
    assert.equal(organization.candidates[0]?.official_url, "https://wandb.ai/");
    assert.equal(organization.review_required, false);
    assert.ok(organization.proposed_sources.some((source) => source.url === "https://docs.wandb.ai/weave"));
    assert.ok(!organization.candidates.some((candidate) => candidate.canonical_name === "AI"));
  });

  it("prefers a transcript-anchored speaker company over a prominently discussed organization", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Github",
          canonical_url: "https://github.blog/",
          primary_domain_code: "coding_agents_developer_tools",
        },
        candidate_names: ["Github", "Sourcegraph"],
      }),
      {
        artifacts: {
          web_context: {
            resources: [],
            entities: [{
              entity_kind: "organization",
              name: "Github",
              canonical_url: "https://github.blog/",
              relationship_to_video: "A competitor and survey publisher discussed in the talk.",
            }],
          },
          transcript_analysis: {
            initial_summary: "Quinn Slack, CEO/co-founder of Sourcegraph, discusses code AI adoption and GitHub Copilot.",
            structured_summary: "Sourcegraph built Cody while GitHub Copilot supplied comparison statistics.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "Quinn Slack CEO co-founder Sourcegraph about page",
        provider: "exa",
        purpose: "Identify the implementation-owning organization",
        result_urls: ["https://sourcegraph.com/about", "https://github.blog/"],
      }],
      { run_id: "00000000-0000-4000-8000-000000000007", research_as_of: "2026-08-25" } as any,
    );

    assert.equal(organization.candidates[0]?.canonical_name, "Sourcegraph");
    assert.equal(organization.candidates[0]?.official_url, "https://sourcegraph.com/");
    assert.ok(!organization.candidates.some((candidate) => candidate.is_primary_featured && candidate.canonical_name === "Github"));
  });

  it("recovers a non-executive speaker employer only from a matching official receipt host", () => {
    const input = {
      artifacts: {
        web_context: { resources: [], entities: [] },
        transcript_analysis: {
          initial_summary: "Vibhor Kumar, senior AI engineer at Tinder, presents trust and safety systems at scale.",
          structured_summary: "At Tinder, the team deploys specialized classifiers for a long tail of harms.",
          evidence_anchors: [],
        },
      },
    };
    const unrelatedOnly = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({}),
      input,
      [{
        query: "Tinder parent company Match Group corporate structure",
        provider: "exa",
        purpose: "Identify the implementation-owning organization",
        result_urls: ["https://www.sec.gov/Archives/example.htm"],
      }],
      { run_id: "00000000-0000-4000-8000-000000000008", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(unrelatedOnly.candidates.length, 0);
    assert.equal(unrelatedOnly.review_required, true);

    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({}),
      input,
      [{
        query: "Tinder official homepage trust safety engineering",
        provider: "exa",
        purpose: "Identify the implementation-owning organization",
        result_urls: ["https://www.tinder.com/safety", "https://www.sec.gov/Archives/example.htm"],
      }],
      { run_id: "00000000-0000-4000-8000-000000000009", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Tinder");
    assert.equal(organization.candidates[0]?.official_url, "https://tinder.com/");
  });

  it("prefers a department-titled speaker employer over a supporting model vendor", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Microsoft",
          canonical_url: "https://microsoft.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: {
            resources: [],
            entities: [{
              entity_kind: "organization",
              name: "Microsoft",
              organization_name: "Microsoft",
              canonical_url: "https://microsoft.com/",
              relationship_to_video: "Supporting model and compute partner.",
            }],
          },
          transcript_analysis: {
            initial_summary: "Shawn Jansepar, Director of Engineering at Khan Academy and product leader of Khanmigo, presents a case study on scaling AI in education.",
            structured_summary: "Microsoft sponsors teacher access and provides Azure compute for Khan Academy's Khanmigo implementation.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "Khan Academy official site Khanmigo implementation engineering",
        provider: "exa",
        purpose: "Identify the implementation-owning organization",
        result_urls: [
          "https://blog.khanacademy.org/how-we-built-ai-tutoring-tools/",
          "https://www.khanacademy.org/khan-labs",
        ],
      }],
      { run_id: "00000000-0000-4000-8000-000000000009", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Khan Academy");
    assert.match(organization.candidates[0]?.official_url ?? "", /khanacademy\.org/);
    assert.equal(organization.review_required, false);
  });

  it("keeps Azure AI as the featured cloud unit instead of flattening it to Microsoft", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Microsoft",
          canonical_url: "https://learn.microsoft.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Two product leaders from Azure AI present the Azure AI model catalog and Azure AI Studio.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000009", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Microsoft Azure AI");
    assert.equal(organization.candidates[0]?.organization_scope, "division");
    assert.equal(organization.candidates[0]?.parent_name, "Microsoft");
    assert.equal(organization.candidates[0]?.parent_canonical_url, "https://www.microsoft.com/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "cloud_ai_platform");
  });

  it("keeps GitHub as the featured Copilot organization and records Microsoft as parent", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Github",
          canonical_url: "https://docs.github.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "A Senior DevOps Advocate at GitHub presents GitHub Copilot's developer tooling and enterprise deployment capabilities.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000011", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "GitHub");
    assert.equal(organization.candidates[0]?.organization_scope, "subsidiary");
    assert.equal(organization.candidates[0]?.parent_name, "Microsoft");
    assert.equal(organization.candidates[0]?.parent_canonical_url, "https://www.microsoft.com/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "coding_agents_developer_tools");
  });

  it("classifies GitHub Advanced Security as AI security while preserving Microsoft hierarchy", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "GitHub",
          canonical_url: "https://github.com/",
          primary_domain_code: "coding_agents_developer_tools",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "A GitHub engineer presents GitHub Advanced Security with CodeQL code scanning, secret scanning, Dependabot, and AI security auto-fix.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000016", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "GitHub");
    assert.equal(organization.candidates[0]?.organization_scope, "subsidiary");
    assert.equal(organization.candidates[0]?.parent_name, "Microsoft");
    assert.equal(organization.candidates[0]?.primary_domain_code, "ai_security_identity_governance");
  });

  it("classifies HiddenLayer's model-security platform as AI security", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Hiddenlayer",
          canonical_url: "https://hiddenlayer.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Andrew Davis of HiddenLayer presents machine learning security, data poisoning, model theft, and adversarial examples.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000017", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "HiddenLayer");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "ai_security_identity_governance");
  });

  it("preserves OctoAI's video-time identity and current NVIDIA ownership", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Octoai",
          canonical_url: "https://octoai.cloud/",
          primary_domain_code: "ai_developer_platform_sdk",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "OctoAI presents LLM fine-tuning, LoRA model serving, and efficient inference hosting.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "OctoAI official inference documentation",
        provider: "exa",
        purpose: "Verify the implementation owner",
        result_urls: ["https://octo.ai/docs/api-reference/octoai-api"],
      }],
      { run_id: "00000000-0000-4000-8000-000000000018", research_as_of: "2026-08-25" } as any,
    );
    const primary = organization.candidates[0];
    assert.equal(primary?.canonical_name, "OctoAI");
    assert.equal(primary?.official_url, "https://octo.ai/");
    assert.equal(primary?.organization_scope, "subsidiary");
    assert.equal(primary?.parent_name, "NVIDIA");
    assert.equal(primary?.parent_canonical_url, "https://www.nvidia.com/");
    assert.equal(primary?.video_time_name, "OctoAI");
    assert.equal(primary?.video_time_parent_name, null);
    assert.equal(primary?.ownership_changed_since_video, true);
    assert.match(primary?.current_status ?? "", /acquired by NVIDIA/i);
    assert.ok(organization.proposed_sources.some((source) => source.publisher === "developer.nvidia.com"));
  });

  it("classifies Convex's reactive database backend as a database/data AI platform", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Convex",
          canonical_url: "https://convex.dev/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Convex's Head of Developer Experience builds an AI phone assistant on Convex reactive database queries and its serverless backend platform.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000019", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Convex");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "database_data_ai_platform");
  });

  it("prefers parenthetically described speaker employer OpenPipe over discussed vLLM", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Vllm",
          canonical_url: "https://docs.vllm.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Kyle Corbitt, co-founder and CEO of OpenPipe (a fine-tuning platform), explains when to fine-tune and discusses self-hosting with vLLM.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "OpenPipe official homepage fine-tuning platform documentation",
        provider: "exa",
        purpose: "Identify the implementation-owning speaker employer",
        result_urls: ["https://openpipe.ai/", "https://docs.openpipe.ai/features/fine-tuning/quick-start"],
      }],
      { run_id: "00000000-0000-4000-8000-000000000020", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "OpenPipe");
    assert.equal(organization.candidates[0]?.official_url, "https://openpipe.ai/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "model_training_inference_platform");
    assert.ok(!organization.candidates.some((candidate) => candidate.is_primary_featured && candidate.canonical_name === "Vllm"));
    assert.ok(organization.proposed_sources.some((source) => source.url.includes("docs.openpipe.ai")));
  });

  it("classifies Gradient's AI Foundry and custom-model training as a model training platform", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Gradient",
          canonical_url: "https://docs.gradient.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Gradient's Chief Scientist presents its AI Foundry, custom language models, continual pre-training, and fine-tuning for a finance-domain LLM.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000027", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Gradient");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "model_training_inference_platform");
  });

  it("classifies Fireworks AI model inference and serving as a model training/inference platform", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Fireworks AI",
          canonical_url: "https://docs.fireworks.ai/getting-started/introduction",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Fireworks AI presents customized, production-ready inference and model serving for open source models.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000029", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Fireworks AI");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "model_training_inference_platform");
  });

  it("keeps a talk concept from replacing the transcript-explicit Perpetual implementation owner", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "personality-driven development",
          canonical_url: "https://benai.agency/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Ben, from Perpetual, presents personality-driven development and the virtual teammates his company builds.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000030", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates.length, 0);
    assert.equal(organization.review_required, true);
  });

  it("rejects the unrelated perpetualai.ie name collision for the transcript company", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Perpetual",
          canonical_url: "https://www.perpetualai.ie/about",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Ben, from Perpetual, explains the virtual teammates and AI employees his company builds.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000035", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates.length, 0);
    assert.equal(organization.review_required, true);
  });

  it("rejects a descriptive virtual-teammates alias that retains the unrelated perpetualai.ie URL", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "virtual teammates",
          canonical_url: "https://perpetualai.ie/",
          primary_domain_code: "other_unknown",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Ben, from Perpetual, explains the virtual teammates and AI employees his company builds.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000036", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates.length, 0);
    assert.equal(organization.review_required, true);
  });

  it("preserves Teammates as current while recording Perpetual as the video-time name", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Teammates",
          canonical_url: "https://www.teammates.work/about",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Ben says what we do at Perpetual is build AI agents called virtual teammates or AI employees.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000032", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Teammates");
    assert.equal(organization.candidates[0]?.video_time_name, "Perpetual");
    assert.equal(organization.candidates[0]?.ownership_changed_since_video, true);
    assert.equal(organization.candidates[0]?.primary_domain_code, "horizontal_ai_application");
  });

  it("restores transcript-explicit Rasgo when an unsupported Klarity candidate is substituted", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Klarity",
          canonical_url: "https://klarity.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Patrick says he was the co-founder and CTO of Rosco and rebuilt its enterprise data product around AI agents.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000033", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Rasgo");
    assert.equal(organization.candidates[0]?.official_url, "https://www.rasgoml.com/");
    assert.equal(organization.candidates[0]?.video_time_name, "Rasgo");
    assert.equal(organization.candidates[0]?.ownership_changed_since_video, false);
    assert.equal(organization.candidates[0]?.primary_domain_code, "enterprise_ai_automation");
  });

  it("restores transcript-explicit Rasgo when a supporting model vendor is promoted", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Claude",
          canonical_url: "https://claude.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Patrick was the co-founder and former CTO of Rosco and explains how they rebuilt the product around AI agents.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000037", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Rasgo");
    assert.equal(organization.candidates[0]?.official_url, "https://www.rasgoml.com/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "enterprise_ai_automation");
  });

  it("does not promote OpenAI from a Model Spec citation in a conceptual Conway's-law talk", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "OpenAI",
          canonical_url: "https://model-spec.openai.com/",
          primary_domain_code: "frontier_model_lab",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Patrick Debois discusses reverse Conway's law, agents taking over organizations, appearing in org charts, and needing codes of conduct.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000036", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates.length, 0);
    assert.equal(organization.review_required, true);
  });

  it("classifies Cohere's enterprise foundation-model lab by its durable role", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Cohere",
          canonical_url: "https://docs.cohere.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "A Cohere engineer explains enterprise LLM agents, Cohere language models, Command R, and the North product.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000034", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Cohere");
    assert.equal(organization.candidates[0]?.primary_domain_code, "frontier_model_lab");
  });

  it("classifies Modal's elastic serverless runtime as a model training/inference platform", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Modal",
          canonical_url: "https://modal.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Modal explains the AI developer experience behind its serverless containers, elastic GPU runtime, and model training workloads.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000031", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Modal");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "model_training_inference_platform");
  });

  it("classifies Daily's realtime voice and media infrastructure as multimodal voice/media AI", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Daily",
          canonical_url: "https://daily.co/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Daily's CEO explains how its real-time audio and video infrastructure, WebRTC, and voice AI bot stack reduce conversational latency.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000022", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Daily");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "multimodal_voice_media_ai");
  });

  it("classifies Deepgram's speech and TTS platform as multimodal voice/media AI", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Deepgram",
          canonical_url: "https://developers.deepgram.com/",
          primary_domain_code: "ai_developer_platform_sdk",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Deepgram's CEO presents its audio AI platform, end-to-end speech recognition, speech-to-text, and text-to-speech products for voice AI agents.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000023", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Deepgram");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "multimodal_voice_media_ai");
  });

  it("classifies Udio music generation as multimodal media AI and attaches technical product evidence", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Udio",
          canonical_url: "https://udio.com/",
          primary_domain_code: "other_unknown",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Udio presents its AI music generation system for music creators, turning text prompts into complete songs.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000024", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Udio");
    assert.equal(organization.candidates[0]?.primary_domain_code, "multimodal_voice_media_ai");
    assert.ok(organization.proposed_sources.some((source) => source.url.includes("help.udio.com")));
    assert.ok(organization.proposed_sources.some((source) => source.source_role === "official_documentation"));
  });

  it("classifies SemiAnalysis research and newsletter analysis as AI community/media", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Semianalysis",
          canonical_url: "https://semianalysis.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Dylan Patel of SemiAnalysis presents research and analysis on frontier-model training and inference infrastructure from the SemiAnalysis newsletter.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000025", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "SemiAnalysis");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "ai_community_education_media");
  });

  it("classifies Crusoe GPU cloud and networking as AI compute systems", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Crusoe",
          canonical_url: "https://crusoe.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Crusoe Cloud presents GPU clusters, rail-optimized InfiniBand networking, and distributed-training infrastructure for mixture-of-experts models.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000026", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Crusoe");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "ai_compute_hardware_systems");
  });

  it("classifies Substrate's modular AI API as a developer platform rather than an end-user app", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Substrate",
          canonical_url: "https://substrate.run/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Substrate's founder presents its modular AI API, computation graph, SDK, and inference primitives for developers.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000012", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Substrate");
    assert.equal(organization.candidates[0]?.primary_domain_code, "ai_developer_platform_sdk");
  });

  it("classifies MongoDB's Atlas vector-search platform as a database/data AI platform", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Mongodb",
          canonical_url: "https://mongodb.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "MongoDB's Director of Product presents RAG with the MongoDB document model and Atlas Vector Search.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000013", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "MongoDB");
    assert.equal(organization.candidates[0]?.primary_domain_code, "database_data_ai_platform");
  });

  it("classifies Snorkel's data-development and fine-tuning platform as AI data curation", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Snorkel",
          canonical_url: "https://docs.snorkel.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Snorkel presents its data development platform for enterprise training data, foundation-model fine-tuning, and alignment.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000014", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Snorkel");
    assert.equal(organization.candidates[0]?.primary_domain_code, "ai_data_curation_training_platform");
  });

  it("keeps Google DeepMind as the Gemma model lab and records Google as parent", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "GitHub",
          canonical_url: "https://github.com/google-deepmind",
          primary_domain_code: "coding_agents_developer_tools",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Kathleen Kenealy, research engineer at Google DeepMind and technical lead of the Gemma team, presents the Gemma open model family.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000021", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Google DeepMind");
    assert.equal(organization.candidates[0]?.official_url, "https://deepmind.google/models/gemma/");
    assert.equal(organization.candidates[0]?.organization_scope, "division");
    assert.equal(organization.candidates[0]?.parent_name, "Google");
    assert.equal(organization.candidates[0]?.primary_domain_code, "frontier_model_lab");
    assert.ok(organization.proposed_sources.filter((source) => source.authority_tier === "first_party").length >= 2);
  });

  it("keeps Google Cloud as the featured Vertex AI unit and records Google as parent", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Google",
          canonical_url: "https://docs.cloud.google.com/",
          primary_domain_code: "ai_developer_platform_sdk",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "A presenter from Google Cloud's Vertex AI team demonstrates the full-lifecycle Vertex AI managed platform, Model Garden, and Agent Builder.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000015", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Google Cloud");
    assert.equal(organization.candidates[0]?.official_url, "https://cloud.google.com/vertex-ai");
    assert.equal(organization.candidates[0]?.organization_scope, "division");
    assert.equal(organization.candidates[0]?.parent_name, "Google");
    assert.equal(organization.candidates[0]?.parent_canonical_url, "https://about.google/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "cloud_ai_platform");
  });

  it("keeps AWS as the featured Bedrock cloud unit and records Amazon as parent", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Amazon",
          canonical_url: "https://docs.aws.amazon.com/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "An AWS Developer Advocate demonstrates Amazon Bedrock, Agents for Amazon Bedrock, and Return of Control through a Minecraft agent.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000028", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "AWS");
    assert.equal(organization.candidates[0]?.official_url, "https://aws.amazon.com/bedrock/");
    assert.equal(organization.candidates[0]?.organization_scope, "division");
    assert.equal(organization.candidates[0]?.parent_name, "Amazon");
    assert.equal(organization.candidates[0]?.primary_domain_code, "cloud_ai_platform");
  });

  it("keeps IBM as the wxflows implementation owner without classifying the parent as an end-user app", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "IBM",
          canonical_url: "https://ibm.biz/",
          primary_domain_code: "horizontal_ai_application",
        },
        featured_implementation: { name: "wxflows" },
      }),
      {
        artifacts: {
          web_context: {
            resources: [{
              resource_type: "webpage",
              title: "IBM wxflows",
              url: "https://ibm.biz/wxflows",
              publisher: "ibm.biz",
              relationship_to_video: "The tool platform demonstrated in the talk.",
              why_valuable: "Documents IBM's wxflows tool platform.",
              claimed_first_party: true,
            }, {
              resource_type: "webpage",
              title: "wxflows Discord",
              url: "https://ibm.biz/wxflows-discord",
              publisher: "ibm.biz",
              relationship_to_video: "Community link.",
              why_valuable: "Community link.",
              claimed_first_party: true,
            }],
            entities: [],
          },
          transcript_analysis: {
            initial_summary: "Roy Derks of IBM demonstrates IBM's wxflows standalone tool platform with watsonx models and a LangGraph agent.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "IBM wxflows official tool platform",
        provider: "exa",
        purpose: "Verify the implementation-owning organization and product",
        result_urls: ["https://ibm.biz/wxflows", "https://ibm.biz/wxflows-discord"],
      }],
      { run_id: "00000000-0000-4000-8000-000000000029", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "IBM");
    assert.equal(organization.candidates[0]?.official_url, "https://www.ibm.com/");
    assert.equal(organization.candidates[0]?.organization_scope, "independent_company");
    assert.equal(organization.candidates[0]?.primary_domain_code, "diversified_technology_company");
    assert.deepEqual(organization.candidates[0]?.secondary_domain_codes, ["ai_developer_platform_sdk"]);
    assert.equal(organization.proposed_sources[0]?.source_role, "official_homepage");
    assert.equal(organization.proposed_sources[1]?.source_role, "official_product");
    assert.ok(!organization.proposed_sources.some((source) => source.url.includes("discord")));
  });

  it("prefers Arize's corporate host over its GitHub owner and assigns the eval domain", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({}),
      {
        artifacts: {
          web_context: { resources: [], entities: [] },
          transcript_analysis: {
            initial_summary: "Aparna Dhinakaran, co-founder of Arize AI, presents production LLM evaluations and observability.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "Arize AI Phoenix official documentation",
        provider: "exa",
        purpose: "Identify the implementation-owning organization",
        result_urls: [
          "https://arize.com/docs/phoenix",
          "https://github.com/Arize-ai/openinference",
        ],
      }],
      { run_id: "00000000-0000-4000-8000-000000000010", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Arize AI");
    assert.equal(organization.candidates[0]?.official_url, "https://arize.com/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "evaluation_observability_llmops");
  });

  it("classifies HoneyHive evaluation tooling as eval/observability rather than an end-user app", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "HoneyHive",
          canonical_url: "https://honeyhive.ai/",
          primary_domain_code: "horizontal_ai_application",
        },
      }),
      {
        artifacts: {
          web_context: {
            resources: [{
              resource_type: "webpage",
              title: "HoneyHive evaluation documentation",
              url: "https://docs.honeyhive.ai/v2/evaluation/introduction",
              publisher: "docs.honeyhive.ai",
              relationship_to_video: "Documents the featured evaluation platform.",
              why_valuable: "Documents HoneyHive LLM evaluation tooling.",
              claimed_first_party: true,
            }],
            entities: [],
          },
          transcript_analysis: {
            initial_summary: "HoneyHive's co-founder presents LLM evaluation tooling, evaluators, datasets, tracing, and production observability for AI engineers.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000030", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "HoneyHive");
    assert.equal(organization.candidates[0]?.official_url, "https://honeyhive.ai/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "evaluation_observability_llmops");
    assert.equal(organization.proposed_sources[0]?.source_role, "official_documentation");
  });

  it("keeps Root Signals eval tooling out of the generic GitHub coding domain", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: {
          name: "Root Signals",
          canonical_url: "https://github.com/root-signals/",
          primary_domain_code: "coding_agents_developer_tools",
        },
      }),
      {
        artifacts: {
          web_context: {
            resources: [{
              resource_type: "webpage",
              title: "Root Signals Agent Evals",
              url: "https://rootsignals.ai/agentevals",
              publisher: "rootsignals.ai",
              relationship_to_video: "The featured agent-evaluation platform.",
              why_valuable: "Documents Root Signals agent evaluation and Eval Ops.",
              claimed_first_party: true,
            }],
            entities: [],
          },
          transcript_analysis: {
            initial_summary: "Ari Heluk of Root Signals presents agent evaluation, LLM-as-judge optimization, tracing and debugging, and Eval Ops as specialized LLM Ops.",
            evidence_anchors: [],
          },
        },
      },
      [],
      { run_id: "00000000-0000-4000-8000-000000000031", research_as_of: "2026-08-25" } as any,
    );
    assert.equal(organization.candidates[0]?.canonical_name, "Root Signals");
    assert.equal(organization.candidates[0]?.official_url, "https://rootsignals.ai/");
    assert.equal(organization.candidates[0]?.primary_domain_code, "evaluation_observability_llmops");
    assert.equal(organization.proposed_sources[0]?.source_role, "official_product");
  });

  it("recovers the current Scorable identity when a Root Signals rebrand leaves the model candidate empty", () => {
    const organization = hydrateOrganizationResearch(
      organizationResearchOutputSchema.parse({
        featured_organization: null,
        review_required: true,
        review_reasons: ["No featured organization with a canonical URL could be established."],
      }),
      {
        artifacts: {
          web_context: {
            resources: [{
              resource_type: "webpage",
              title: "Scorable official homepage",
              url: "https://scorable.ai/",
              publisher: "scorable.ai",
              relationship_to_video: "Current identity of Root Signals.",
              why_valuable: "Establishes the current Scorable evaluation platform.",
              claimed_first_party: false,
            }],
            entities: [],
          },
          transcript_analysis: {
            initial_summary: "Ari Heljakka of Root Signals presents agent evaluation, LLM-as-judge, tracing and debugging, and Eval Ops.",
            evidence_anchors: [],
          },
        },
      },
      [{
        query: "Root Signals Scorable rebrand official homepage",
        provider: "exa",
        purpose: "Identify the current implementation-owning organization.",
        result_urls: [
          "https://scorable.ai/",
          "https://docs.scorable.ai/quick-start/evaluator-portfolio",
          "https://github.com/root-signals/scorable-sdk",
        ],
      }],
      { run_id: "00000000-0000-4000-8000-000000000034", research_as_of: "2026-08-25" } as any,
    );
    const primary = organization.candidates[0];
    assert.equal(primary?.canonical_name, "Scorable");
    assert.equal(primary?.official_url, "https://scorable.ai/");
    assert.equal(primary?.video_time_name, "Root Signals");
    assert.equal(primary?.ownership_changed_since_video, true);
    assert.equal(primary?.primary_domain_code, "evaluation_observability_llmops");
    assert.equal(organization.review_required, false);
    assert.deepEqual(organization.review_reasons, []);
    assert.ok(organization.proposed_sources.some((source) => source.source_role === "official_homepage"
      && source.authority_tier === "first_party"));
    assert.ok(organization.proposed_sources.some((source) => source.source_role === "official_documentation"
      && source.authority_tier === "first_party"));
  });

  it("retries real structured-output and budget abort signatures with a bounded cap", () => {
    for (const error of [
      new Error("STAGE_STRUCTURED_OUTPUT_INVALID: primary missing"),
      new Error("STAGE_JSON_NOT_FOUND"),
      Object.assign(new Error("Delay was aborted"), { name: "AbortError" }),
      new Error("CONTROLLER_INVOCATION_BUDGET_EXHAUSTED"),
    ]) {
      assert.equal(classifyError(error).retryable, true);
    }
    assert.equal(maxStageAttempts(undefined), 3);
    assert.throws(() => maxStageAttempts("9"), /between 1 and 8/);
  });

  it("keeps redacted stage retry detail in operator receipts", async () => {
    const runner = await readFile(new URL("../controller/stages/stage-runner.ts", import.meta.url), "utf8");
    assert.match(runner, /error_detail\?: string/);
    assert.match(runner, /error_detail: classified\.detail/);
  });

  it("does not import or operate Eve sessions in the automatic controller", async () => {
    const controller = await readFile(
      new URL("../controller/pre-research-pipeline.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(controller, /from\s+["']eve\/client["']/);
    assert.doesNotMatch(controller, /\.sessions\.(?:create|attach)/);
    assert.doesNotMatch(controller, /\.reset\(|\.cancel\(|\.stream\(/);
  });

  it("lets a deadline-free local process finish all stages serially", async () => {
    const controller = await readFile(new URL("../controller/pre-research-pipeline.ts", import.meta.url), "utf8");
    assert.match(controller, /deadlineAtMs == null \? PRE_RESEARCH_STAGES\.length/);
    assert.match(controller, /process\.env\.VERCEL \? DEFAULT_STAGE_LEASE_SECONDS : 1_800/);
    assert.match(controller, /receipt\.status === "dead_letter"[\s\S]*failRunWithDeadLetter/);
  });

  it("uses the canonical authoritative-source validator before assigning a known organization domain", async () => {
    const runner = await readFile(new URL("../controller/stages/stage-runner.ts", import.meta.url), "utf8");
    assert.match(runner, /validateAuthoritativeSourceMinimum\(primarySources\)/);
    assert.match(runner, /thinEvidence = primarySources\.length < 2 \|\| !sourceMinimum\.ok/);
  });

  it("preserves immutable manifest identity when completing a legacy partial run", async () => {
    const synthesisTool = await readFile(
      new URL("../agent/tools/save_synthesis_stage_packet.ts", import.meta.url),
      "utf8",
    );
    const runner = await readFile(
      new URL("../controller/stages/stage-runner.ts", import.meta.url),
      "utf8",
    );
    assert.match(synthesisTool, /prompt_bundle_version: run\.prompt_bundle_version/);
    assert.match(synthesisTool, /taxonomy_version: run\.taxonomy_version/);
    assert.doesNotMatch(runner, /intent\.source\.prompt_bundle_version\s*=/);
  });

  it("keeps large values out of the stage-ledger schema", async () => {
    const migration = await readFile(
      new URL("../../supabase/migrations/20260824011000_stateless_pre_research_stage_execution.sql", import.meta.url),
      "utf8",
    );
    const table = migration.slice(
      migration.indexOf("create table if not exists public.research_pre_research_stage_execution"),
      migration.indexOf("create index if not exists research_pre_research_stage_execution_ready_idx"),
    );
    assert.doesNotMatch(table, /\b(prompt|transcript|response_body|page_body|raw_response)\b/i);
    assert.match(table, /input_manifest_path text/);
    assert.match(table, /usage_summary jsonb/);
  });

  it("requires every predecessor to complete before a later database stage can be leased", async () => {
    const migration = await readFile(
      new URL("../../supabase/migrations/20260825022000_pre_research_stage_dependency_guard.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /predecessor\.status <> 'completed'/);
    assert.match(migration, /array_position\(v_stage_order, predecessor\.stage\) < array_position\(v_stage_order, e\.stage\)/);
  });

  it("does not strand compatible in-flight runs when the prompt bundle is upgraded", async () => {
    const localDrain = await readFile(
      new URL("../scripts/run-all-pre-research-pipelines.mjs", import.meta.url),
      "utf8",
    );
    const scheduler = await readFile(
      new URL("../controller/scheduled-pre-research.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(localDrain, /listRecoverableRuns\(\{\s*promptBundleVersion/);
    assert.doesNotMatch(scheduler, /r\.prompt_bundle_version\s*=\s*\$4/);
  });

  it("keeps expected review deferrals out of the local drain error stream", async () => {
    const localDrain = await readFile(
      new URL("../scripts/run-all-pre-research-pipelines.mjs", import.meta.url),
      "utf8",
    );
    assert.match(
      localDrain,
      /console\.log\(JSON\.stringify\(\{ event: "video_deferred_for_review"/,
    );
    assert.doesNotMatch(
      localDrain,
      /console\.error\(JSON\.stringify\(\{ event: "video_deferred_for_review"/,
    );
  });

  it("cooperatively stops a local drain before it can claim the next video", async () => {
    const localDrain = await readFile(
      new URL("../scripts/run-all-pre-research-pipelines.mjs", import.meta.url),
      "utf8",
    );
    const boundaryWatcher = await readFile(
      new URL("../scripts/stop-local-worker-after-result.ps1", import.meta.url),
      "utf8",
    );
    assert.match(localDrain, /consumeBoundaryStopRequest\(result\)/);
    assert.match(localDrain, /boundary_stop_acknowledged/);
    assert.match(localDrain, /process\.exitCode = 75;\s*break;/);
    assert.match(boundaryWatcher, /stop-after-result\.json/);
    assert.match(boundaryWatcher, /boundary_stop_cooperative/);
  });

  it("releases only a pre-checkpoint empty lease owned by a proven-dead worker", async () => {
    const releaseScript = await readFile(
      new URL("../scripts/release-orphaned-empty-stage.mts", import.meta.url),
      "utf8",
    );
    assert.match(releaseScript, /DEAD_WORKER_STILL_RUNNING/);
    assert.match(releaseScript, /e\.lease_owner = \$3::text/);
    assert.match(releaseScript, /e\.input_manifest_path is null/);
    assert.match(releaseScript, /not exists \([\s\S]*research_pre_research_artifact/);
    assert.match(releaseScript, /not exists \([\s\S]*research_ingestion_intent/);
  });
});
