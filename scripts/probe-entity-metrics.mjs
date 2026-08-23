import { writeFile } from "node:fs/promises";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key.startsWith("--")) {
    args.set(key.slice(2), value && !value.startsWith("--") ? value : true);
    if (value && !value.startsWith("--")) index += 1;
  }
}

const examples = {
  githubRepo: String(args.get("github-repo") || "langchain-ai/langgraph"),
  githubUser: String(args.get("github-user") || process.env.GITHUB_USERNAME || "simonw"),
  npmPackage: String(args.get("npm-package") || "@langchain/langgraph"),
  pypiPackage: String(args.get("pypi-package") || "langgraph"),
  huggingFaceModel: String(args.get("hf-model") || "Qwen/Qwen2.5-Coder-7B-Instruct"),
  paperId: String(args.get("paper-id") || "ARXIV:2210.03629"),
  doi: String(args.get("doi") || "10.48550/arXiv.2210.03629"),
  crossrefDoi: String(args.get("crossref-doi") || "10.1038/s41586-021-03819-2"),
  youtubeUrl: String(args.get("youtube-url") || "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
};

const timeoutMs = Number(args.get("timeout-ms") || 20_000);
const includePaid = args.has("include-paid");

function redactUrl(url) {
  const parsed = new URL(url);
  for (const key of ["api_key", "key", "token", "access_token"]) {
    if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
  }
  return parsed.toString();
}

async function requestJson(url, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "user-agent": "ai-engineer-entity-metrics-probe/0.1",
      ...options.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text: text.slice(0, 1_000) };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.details = { status: response.status, body };
    throw error;
  }
  return {
    body,
    latency_ms: Date.now() - startedAt,
    rate_limit: {
      limit: response.headers.get("x-ratelimit-limit"),
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset"),
    },
  };
}

function githubHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return {
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function pageCountFromLink(link) {
  if (!link) return null;
  const match = link.match(/[?&]page=(\d+)>; rel="last"/);
  return match ? Number(match[1]) : null;
}

async function githubRepo() {
  const base = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const repo = encodeURI(examples.githubRepo);
  const common = { headers: githubHeaders() };
  const [metadata, contributors, releases, participation] = await Promise.all([
    requestJson(`${base}/repos/${repo}`, common),
    fetch(`${base}/repos/${repo}/contributors?anon=true&per_page=1`, {
      headers: { accept: "application/json", "user-agent": "ai-engineer-entity-metrics-probe/0.1", ...githubHeaders() },
      signal: AbortSignal.timeout(timeoutMs),
    }),
    requestJson(`${base}/repos/${repo}/releases?per_page=5`, common),
    requestJson(`${base}/repos/${repo}/stats/participation`, common).catch((error) => ({ error: error.message })),
  ]);
  const contributorBody = await contributors.json();
  return {
    source: "github_rest",
    locator: `${base}/repos/${repo}`,
    observed_at: new Date().toISOString(),
    metrics: {
      stars: metadata.body.stargazers_count,
      forks: metadata.body.forks_count,
      watchers: metadata.body.subscribers_count,
      open_issues_including_pull_requests: metadata.body.open_issues_count,
      network_count: metadata.body.network_count,
      size_kib: metadata.body.size,
      archived: metadata.body.archived,
      last_push_at: metadata.body.pushed_at,
      created_at: metadata.body.created_at,
      updated_at: metadata.body.updated_at,
      contributor_count_lower_bound: pageCountFromLink(contributors.headers.get("link")) || (Array.isArray(contributorBody) ? contributorBody.length : null),
      recent_release_count_sample: Array.isArray(releases.body) ? releases.body.length : null,
      last_release_at: Array.isArray(releases.body) ? releases.body[0]?.published_at ?? null : null,
      commits_last_52_weeks: Array.isArray(participation.body?.all)
        ? participation.body.all.reduce((sum, value) => sum + value, 0)
        : null,
    },
    caveats: [
      "open_issues_count includes pull requests",
      "stars/watchers are attention signals, not evidence quality",
      "traffic views/clones require push access and only expose a short rolling window",
    ],
    rate_limit: metadata.rate_limit,
  };
}

async function githubUser() {
  const base = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const result = await requestJson(`${base}/users/${encodeURIComponent(examples.githubUser)}`, { headers: githubHeaders() });
  return {
    source: "github_rest",
    locator: `${base}/users/${encodeURIComponent(examples.githubUser)}`,
    observed_at: new Date().toISOString(),
    metrics: {
      public_repositories: result.body.public_repos,
      followers: result.body.followers,
      following: result.body.following,
      account_created_at: result.body.created_at,
      profile_updated_at: result.body.updated_at,
    },
    caveats: ["Profile counts do not establish authorship, employment, expertise, or contribution quality."],
    rate_limit: result.rate_limit,
  };
}

async function npmDownloads() {
  const name = encodeURIComponent(examples.npmPackage);
  const result = await requestJson(`https://api.npmjs.org/downloads/point/last-month/${name}`);
  return {
    source: "npm_downloads_api",
    locator: `https://api.npmjs.org/downloads/point/last-month/${name}`,
    observed_at: new Date().toISOString(),
    metrics: { downloads_last_month: result.body.downloads, start: result.body.start, end: result.body.end },
    caveats: ["Downloads include CI, mirrors, caches, bots, and repeated installs; compare within registry and cohort."],
  };
}

async function pypiDownloads() {
  const name = encodeURIComponent(examples.pypiPackage);
  let result;
  try {
    result = await requestJson(`https://pypistats.org/api/packages/${name}/recent`);
  } catch (error) {
    const metadata = await requestJson(`https://pypi.org/pypi/${name}/json`);
    return {
      source: "pypi_json_api",
      locator: `https://pypi.org/pypi/${name}/json`,
      observed_at: new Date().toISOString(),
      metrics: {
        downloads_unavailable: true,
        latest_version: metadata.body.info?.version,
        release_count: Object.keys(metadata.body.releases || {}).length,
      },
      acquisition_error: `pypistats unavailable: ${error.cause?.message || error.message}`,
      caveats: [
        "PyPI's official JSON API exposes package metadata but no download counts.",
        "Use pypistats or query PyPI's public BigQuery download dataset when available.",
      ],
    };
  }
  return {
    source: "pypistats_api",
    locator: `https://pypistats.org/api/packages/${name}/recent`,
    observed_at: new Date().toISOString(),
    metrics: result.body.data,
    caveats: ["PyPI does not publish a first-party simple download-count endpoint; pypistats derives counts from public BigQuery data."],
  };
}

async function huggingFaceModel() {
  const model = examples.huggingFaceModel.split("/").map(encodeURIComponent).join("/");
  const result = await requestJson(`https://huggingface.co/api/models/${model}`);
  return {
    source: "huggingface_hub_api",
    locator: `https://huggingface.co/api/models/${model}`,
    observed_at: new Date().toISOString(),
    metrics: {
      downloads_30d: result.body.downloads,
      likes: result.body.likes,
      trending_score: result.body.trendingScore,
      last_modified_at: result.body.lastModified,
      library_name: result.body.library_name,
      pipeline_tag: result.body.pipeline_tag,
      gated: result.body.gated,
    },
    caveats: ["Hub downloads use file-query counting rules and are not unique users or production adoption."],
  };
}

async function openAlexPaper() {
  const filter = encodeURIComponent(`doi:${examples.doi.toLowerCase()}`);
  const result = await requestJson(`https://api.openalex.org/works?filter=${filter}&per-page=1`);
  const work = result.body.results?.[0];
  return {
    source: "openalex",
    locator: `https://api.openalex.org/works?filter=${filter}&per-page=1`,
    observed_at: new Date().toISOString(),
    metrics: work ? {
      openalex_id: work.id,
      cited_by_count: work.cited_by_count,
      works_cited_count: work.referenced_works_count,
      citation_percentile: work.citation_normalized_percentile?.value ?? null,
      fwci: work.fwci,
      open_access: work.open_access,
      publication_date: work.publication_date,
      topics: work.topics?.slice(0, 5).map(({ id, display_name, score }) => ({ id, display_name, score })),
      counts_by_year: work.counts_by_year,
    } : null,
    caveats: ["Citation coverage and author disambiguation vary; snapshot counts and retain external IDs."],
  };
}

async function semanticScholarPaper() {
  const fields = "title,year,citationCount,influentialCitationCount,referenceCount,authors,publicationTypes,publicationDate,openAccessPdf,fieldsOfStudy,s2FieldsOfStudy";
  const result = await requestJson(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(examples.paperId)}?fields=${encodeURIComponent(fields)}`);
  return {
    source: "semantic_scholar_graph_api",
    locator: `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(examples.paperId)}`,
    observed_at: new Date().toISOString(),
    metrics: {
      semantic_scholar_id: result.body.paperId,
      citations: result.body.citationCount,
      influential_citations: result.body.influentialCitationCount,
      references: result.body.referenceCount,
      year: result.body.year,
      fields_of_study: result.body.s2FieldsOfStudy,
    },
    caveats: ["Provider-specific citation counts are not interchangeable; influential citations are model-derived."],
  };
}

async function crossrefPaper() {
  const result = await requestJson(`https://api.crossref.org/works/${encodeURIComponent(examples.crossrefDoi)}`);
  const work = result.body.message;
  return {
    source: "crossref",
    locator: `https://api.crossref.org/works/${encodeURIComponent(examples.crossrefDoi)}`,
    observed_at: new Date().toISOString(),
    metrics: {
      is_referenced_by_count: work["is-referenced-by-count"],
      references_count: work["references-count"],
      type: work.type,
      deposited_at: work.deposited?.["date-time"],
      indexed_at: work.indexed?.["date-time"],
    },
    caveats: ["Crossref counts cover deposited links in its graph and should not be equated with another citation provider."],
  };
}

async function youtubeOembed() {
  const result = await requestJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(examples.youtubeUrl)}&format=json`);
  return {
    source: "youtube_oembed",
    locator: `https://www.youtube.com/oembed?url=${encodeURIComponent(examples.youtubeUrl)}&format=json`,
    observed_at: new Date().toISOString(),
    metrics: { title: result.body.title, author_name: result.body.author_name, author_url: result.body.author_url },
    caveats: ["oEmbed resolves identity but exposes no view/like/comment metrics; those require YouTube Data API credentials."],
  };
}

async function tavilySearch() {
  if (!process.env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is not configured");
  const result = await requestJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: "LangGraph official repository documentation paper",
      search_depth: "basic",
      max_results: 3,
      include_answer: false,
    }),
  });
  return {
    source: "tavily_search",
    locator: "https://api.tavily.com/search",
    observed_at: new Date().toISOString(),
    metrics: { result_count: result.body.results?.length ?? 0, response_time_seconds: result.body.response_time },
    candidates: result.body.results?.map(({ title, url, score }) => ({ title, url, provider_score: score })),
    caveats: ["Search relevance is a discovery signal; fetch and qualify the underlying source before using it as evidence."],
  };
}

async function xaiXSearch() {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not configured");
  const result = await requestJson("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.XAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: String(args.get("xai-model") || "grok-4.6"),
      input: String(args.get("xai-prompt") || "Find up to 3 recent public X posts by @OpenAI about developers or APIs. Return concise JSON with post URL and date. Include engagement counts only when the tool explicitly supplies them; otherwise use null. Do not estimate counts."),
      tools: [{ type: "x_search", allowed_x_handles: ["OpenAI"] }],
      max_output_tokens: Number(args.get("xai-max-output-tokens") || 300),
    }),
  });
  const outputItems = Array.isArray(result.body.output) ? result.body.output : [];
  const contentItems = outputItems.flatMap((item) => Array.isArray(item.content) ? item.content : []);
  const outputText = contentItems
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  const nestedCitations = contentItems.flatMap((item) =>
    Array.isArray(item.annotations)
      ? item.annotations.filter((annotation) => annotation.type === "url_citation")
      : [],
  );
  const citations = result.body.citations || result.body.sources || nestedCitations;
  return {
    source: "xai_responses_x_search",
    locator: "https://api.x.ai/v1/responses",
    observed_at: new Date().toISOString(),
    metrics: {
      model: result.body.model,
      status: result.body.status,
      citations_or_sources_count: citations.length,
      input_tokens: result.body.usage?.input_tokens,
      output_tokens: result.body.usage?.output_tokens,
      reasoning_tokens: result.body.usage?.output_tokens_details?.reasoning_tokens,
    },
    result_excerpt: (outputText || result.body.output_text || JSON.stringify(result.body.output || "")).slice(0, 4_000),
    citations,
    caveats: [
      "xAI X Search is a grounded discovery/synthesis tool, not the canonical X Developer API metric endpoint.",
      "Model-rendered engagement counts must remain unverified unless anchored to structured provider output or independently fetched.",
    ],
  };
}

const probes = {
  github_repo: githubRepo,
  github_user: githubUser,
  npm_downloads: npmDownloads,
  pypi_downloads: pypiDownloads,
  huggingface_model: huggingFaceModel,
  openalex_paper: openAlexPaper,
  semantic_scholar_paper: semanticScholarPaper,
  crossref_paper: crossrefPaper,
  youtube_oembed: youtubeOembed,
  tavily_search: tavilySearch,
  ...(includePaid ? { xai_x_search: xaiXSearch } : {}),
};

const requested = args.get("only")
  ? String(args.get("only")).split(",").map((value) => value.trim())
  : Object.keys(probes);

const results = [];
for (const name of requested) {
  const probe = probes[name];
  if (!probe) {
    results.push({ probe: name, ok: false, error: "unknown or disabled probe" });
    continue;
  }
  try {
    const value = await probe();
    results.push({ probe: name, ok: true, ...value, locator: value.locator ? redactUrl(value.locator) : undefined });
  } catch (error) {
    results.push({
      probe: name,
      ok: false,
      error: error.message,
      status: error.details?.status,
      details: error.details?.body ? JSON.stringify(error.details.body).slice(0, 1_000) : undefined,
    });
  }
}

const report = {
  schema_version: "entity-metric-probe-0.1.0",
  observed_at: new Date().toISOString(),
  examples,
  include_paid: includePaid,
  results,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (args.get("out")) await writeFile(String(args.get("out")), serialized, "utf8");
process.stdout.write(serialized);
