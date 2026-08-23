# Metric Source Catalog

**Status:** implementation specification  
**Research snapshot:** 2026-08-22 (limits, prices, and terms are dynamic; persist the observed response headers and policy version)  
**Scope:** engineers, organizations, software products, libraries/packages, GitHub repositories, papers, and talks/videos/reports

## 1. The operating model

A useful ranking system does not ask only, “How large is this entity?” It asks four different questions:

1. **Reach:** how many people encountered it?
2. **Adoption:** how many people or projects actually used it?
3. **Endorsement:** who deliberately vouched for it?
4. **Durable contribution:** did it change subsequent work, remain maintained, and transfer useful knowledge?

Those questions require different sources. A GitHub star is public intent, a package download is noisy consumption, a dependent repository is adoption, a citation is scholarly reuse, and owner-only product analytics are actual attention. They must remain separate features until a downstream, cohort-aware scorer combines them.

Use this source priority:

| Tier | Meaning | Examples | Ranking use |
|---|---|---|---|
| A | First-party measurement or canonical registry | GitHub API, npm/PyPI registry, Crossref deposit, YouTube API | Primary feature |
| B | Open scholarly/community graph with transparent provenance | OpenAlex, Semantic Scholar, Hacker News API | Primary with source-specific confidence |
| C | Licensed estimator or review provider | Similarweb, Crunchbase, G2 | Secondary/corroborating; label as estimated or sampled |
| D | Search/extraction observation | Firecrawl, Tavily, xAI search result | Discovery/evidence only unless the underlying canonical page is captured |
| E | Unofficial scraper/aggregator | arbitrary social scrapers, cached leaderboards | Leads only; do not silently convert to a quantitative fact |

Never put credentials, private analytics, or personal data into an LLM prompt. Collect structured responses first, redact, then supply only necessary fields to synthesis agents.

## 2. Common observation contract

Every number should be stored as an observation, not overwritten on an entity row.

```json
{
  "entity_id": "repo:github:langchain-ai/langchain",
  "metric_key": "github.stargazers_count",
  "value": 123456,
  "unit": "accounts",
  "window": "lifetime",
  "as_of": "2026-08-22T20:00:00Z",
  "collected_at": "2026-08-22T20:03:12Z",
  "source": "github_rest",
  "source_url": "https://api.github.com/repos/langchain-ai/langchain",
  "access_tier": "public_authenticated",
  "visibility": "public",
  "measurement_kind": "platform_counter",
  "is_estimate": false,
  "raw_response_hash": "sha256:...",
  "collector_version": "github-rest@1.0.0",
  "policy_version_observed": "2026-03-10",
  "quality_flags": ["cumulative", "gameable"],
  "provenance": {"request_id": "...", "etag": "..."}
}
```

Required behavior:

- Append observations and derive deltas from snapshots; do not depend on providers to supply history.
- Store `null` for unavailable and never convert missing to zero.
- Keep `platform`, `metric definition`, `window`, and `visibility` in the metric key or dimensions.
- Use `ETag`/`If-None-Match`, conditional requests, exponential backoff, and response rate-limit headers.
- Record deletions and counter decreases rather than “fixing” them; both can reveal moderation, bot cleanup, or changed definitions.
- Separate **observed counter** from **derived score**. The raw observation is reproducible; the score is versioned logic.

### Freshness classes

| Class | Suggested collection | Suitable signals |
|---|---:|---|
| Event/near-real-time | webhook or 15–60 min | GitHub pushes/releases; HN items; product incidents |
| Daily | 1/day | stars, followers, package downloads, citations, video views, review counts |
| Weekly | 1/week | contributor graph, dependents, web traffic estimates, company headcount |
| Monthly/quarterly | 1/month or after filing | funding, employee estimates, annual reports, benchmark results |
| Immutable/event-derived | once + correction sweep | DOI, ORCID, release date, conference, license, video publish date |

Daily collection does not imply daily source updates. Preserve both `as_of` and `collected_at`.

## 3. Identity resolution before metrics

Metrics become dangerous when entities are merged incorrectly. Store provider IDs and explicit edges, not name-only joins.

| Entity | Preferred identifiers | Useful reconciliation keys |
|---|---|---|
| Engineer | internal person ID, ORCID, OpenAlex Author ID, Semantic Scholar Author ID, GitHub numeric user ID | verified domains, email hashes from consented/public commits, affiliations, coauthor graph; GitHub handles can change |
| Organization | ROR ID, OpenAlex Institution ID, legal entity ID/LEI where applicable, GitHub org numeric ID, Crunchbase UUID/permalink | canonical domains, subsidiaries, acquisitions, aliases |
| Product | internal product ID, canonical domain, Product Hunt post ID, G2 product ID | vendor-product edge, package/repo/docs URLs, former names |
| Package/library | Package URL (`purl`), ecosystem + normalized package name, version | registry project URL, repository URL, SPDX license ID |
| Repository | GitHub/host numeric repository ID and node ID | owner/name is mutable; record transfer/rename chain, canonical clone URL |
| Paper | DOI first, then PMID/PMCID/arXiv ID/OpenAlex Work ID/S2 Paper ID | title + year + author set only as probabilistic fallback; track versions and retractions |
| Talk/video/report | YouTube video ID, DOI, arXiv/report number, conference session ID, canonical URL | title/speaker/date/venue fingerprint; distinguish reuploads and clips |

Entity resolution output needs `match_method`, confidence, supporting fields, and human-review state. A metric collector must refuse ambiguous matches rather than attach a plausible-looking number.

## 4. Source catalog

### 4.1 GitHub: engineers, organizations, products, libraries, and repositories

**Access.** REST and GraphQL are official and free for public data. The existing `GH_TOKEN`/`GITHUB_TOKEN` can authenticate; never print it or place it in a URL. REST generally allows 60 requests/hour unauthenticated and 5,000/hour for an authenticated user; GitHub Apps scale differently. Search has separate restrictions and secondary limits apply. Read the response headers and `/rate_limit`; limits can change. [GitHub REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

**Identifiers.** Capture numeric `id`, GraphQL `node_id`, owner numeric ID, `full_name`, and URL. Numeric IDs survive most renames/transfers; names do not.

**Public repository metrics:**

- `stargazers_count`, forks, watchers/subscribers, open issues (note that GitHub's aggregate `open_issues_count` includes pull requests), archived/fork/template flags, license, topics, default branch.
- Star events with timestamps when the listing is permitted; use this to build growth curves. GitHub documents that `watchers`/`watchers_count` currently mean stars and `subscribers_count` means watches. [Starring endpoints](https://docs.github.com/en/rest/activity/starring).
- Commits, releases/tags, last push, issue/PR creation and closure, merged PRs, review participation, discussion activity, contributor count/concentration, bus factor proxies, commit cadence and dormant periods.
- Community health: README, license, contributing guide, code of conduct, issue/PR templates, security policy. [Community metrics endpoint](https://docs.github.com/en/rest/metrics/community).
- Code-frequency, participation, contributor, and commit-activity endpoints. These can return `202 Accepted` while GitHub computes statistics; retry with backoff. [Repository statistics](https://docs.github.com/en/rest/metrics/statistics).
- Dependency graph/dependents when available, lockfile/package manifests, and repository topics. Public UI counts are not a stable API contract; prefer registry dependency data or licensed datasets for exhaustive reverse dependencies.

**Engineer metrics:** public followers/following, public repositories, contributions by role, accepted/merged PRs, reviews, issue resolution, releases maintained, languages/topics, cross-organization work, recency, and collaborator diversity. Do not use raw commit count as “skill.” Normalize bot accounts, generated commits, monorepos, employer time, and project size. GitHub's public contribution calendar is incomplete evidence, not a complete work history.

**Organization/product metrics:** member and repository counts where public, portfolio release velocity, contributor diversity, response/merge latency, security/advisory practice, share of archived repositories, dependency reach, and concentration risk. Private org metrics require authorization.

**Owner-only metrics:** repository traffic views, unique visitors, clones, unique cloners, popular paths/referrers are valuable but require push access/admin-equivalent authorization and cover a short rolling window (commonly 14 days). Collect daily if the owner opts in. Never rank opted-in products against public-only products without a missingness-aware model. [Traffic endpoints](https://docs.github.com/en/rest/metrics/traffic).

**History.** Git events and dated stars/releases allow partial reconstruction; cumulative counters do not expose complete historical snapshots. GH Archive/BigQuery can supply public event history from 2011 onward, subject to its schema and missing-event caveats. Begin first-party snapshots immediately.

**Gaming/bias:** purchased/star-exchange stars, mass-fork campaigns, hackathon spikes, mirrors, monorepos, bots, squashed commits, and popularity feedback loops. Detect burstiness, low-activity stargazers, star/fork/download divergence, reciprocal patterns, geography/time synchronization, and deletion corrections. Treat these as flags, not automatic guilt.

### 4.2 Package registries and model hubs: libraries and software artifacts

Package metrics are ecosystem-specific. Never compare a raw npm download to a PyPI download without within-ecosystem normalization and time windows.

| Source | What to collect | Access, history, and caveats |
|---|---|---|
| npm registry + downloads service | package metadata, versions/timestamps, maintainers, deprecation, weekly/monthly downloads, point/range download counts | Public registry APIs are allowed when publicly documented/made available; obey npm terms. Downloads include CI, caches, mirrors, bots, transitive installs, and version-checking behavior. Snapshot daily/weekly. [npm registry](https://docs.npmjs.com/cli/using-npm/registry/) and [open-source terms](https://docs.npmjs.com/policies/open-source-terms/). |
| PyPI JSON/Index APIs | normalized name, releases/files, upload dates, yanks, Python requirements, project links, vulnerabilities | Free public metadata. PyPI intentionally puts download logs in public BigQuery (`bigquery-public-data.pypi.file_downloads`); BigQuery has Google billing/free-tier economics and query cost. pypistats.org is a convenient independent aggregate, not PyPI itself. [PyPI JSON API](https://docs.pypi.org/api/json/) and [BigQuery datasets](https://docs.pypi.org/api/bigquery/). |
| crates.io | crate metadata, versions, total/recent downloads, owners, reverse dependencies, repository | Public API; send a descriptive User-Agent/contact and honor runtime throttling. Downloads remain automation-sensitive. Prefer crates.io database dumps for bulk work when offered. [crates.io data access policy](https://crates.io/data-access). |
| NuGet | registration/catalog metadata, versions, owners, deprecation/vulnerability, package download totals, repository metadata | Official V3 service index is the discovery root. Catalog is append-only event history useful for incremental ingest. [NuGet API](https://learn.microsoft.com/en-us/nuget/api/overview). |
| Maven Central | component/version metadata, timestamps, namespaces, checksums, dependency metadata | Use Central Search/Publisher APIs or published index; namespace can proxy organization. Download counts are not generally an open comparable metric. [Maven Central API docs](https://central.sonatype.org/api-guide/). |
| RubyGems | versions, dependencies, downloads, owners, metadata | Public API; cumulative downloads are exposed, but automation/transitive bias remains. [RubyGems API](https://guides.rubygems.org/rubygems-org-api/). |
| Packagist | package versions, dependents/suggesters, downloads, GitHub-derived metadata | Public metadata endpoints. GitHub fields inherit GitHub biases and may be stale. [Packagist API](https://packagist.org/apidoc). |
| Conda/Anaconda | package/version/build/channel/platform metadata, download counts where exposed | Distinguish `defaults`, conda-forge, and private channels; duplicated binaries across platforms inflate artifact counts. Treat undocumented endpoints as unstable. |
| Docker Hub | pull count, stars, tags, last updated, image architectures | Pulls include CI and repeated layers; counts are cumulative and can be enormous. API/policies and limits vary by authentication and plan. [Docker Hub API](https://docs.docker.com/reference/api/hub/latest/). |
| Hugging Face Hub | model/dataset/Space downloads, likes, tags/tasks, trending score, commits, discussions, model-card metadata | Public API/OpenAPI plus official SDK. Three request buckets (Hub API, resolvers, pages), fixed five-minute windows, plan-dependent values in headers. [Hub API](https://huggingface.co/docs/hub/en/api), [rate limits](https://huggingface.co/docs/hub/en/rate-limits), and [download definition](https://huggingface.co/docs/hub/en/models-download-stats). |

**High-value derived adoption metrics:** direct vs transitive dependents; number and quality of dependent repositories; organizations represented among dependents; release frequency; median time between releases; supported runtime versions; yanked/recalled releases; known vulnerabilities and remediation lag; maintainer count/concentration; newcomer contribution rate; semantic-version stability; documentation/examples/tests/typing coverage; and install-to-star divergence.

**History.** Registry release timestamps are usually durable. Download APIs often offer only bounded windows; PyPI BigQuery and event catalogs are stronger. Start daily snapshots and preserve per-version data. Avoid requesting “all time” when the provider silently caps the range.

### 4.3 Papers and technical reports

Use at least two scholarly graphs because coverage, author disambiguation, versions, and citation counts differ.

| Source | Metrics and identifiers | Access/freshness/history | Caveats |
|---|---|---|---|
| OpenAlex | DOI/PMID/PMCID/arXiv IDs, OpenAlex IDs; works/authors/institutions/sources/topics; `cited_by_count`, yearly counts, references, OA, authorship, concepts/topics | Free API; current service uses an API-key/credit model and a 100 requests/sec ceiling; consult `/rate-limit` and response metadata rather than hard-coding daily credits. Full snapshots are downloadable for bulk/historical work. [API reference](https://help.openalex.org/api/) and [authentication](https://developers.openalex.org/api-reference/authentication). | Citation coverage and entity resolution are modeled; author merges/splits change. Counts can decrease after corrections. |
| Semantic Scholar | S2 Paper/Author IDs plus DOI/arXiv/etc.; citation count, influential citation count, references, fields, TLDR/abstract, embeddings, recommendations | Most graph endpoints public; API key recommended. Current introductory key limit is 1 request/sec; unauthenticated users share a pool and can be throttled. Batch endpoints and downloadable datasets/incremental diffs are preferable for scale. [API overview](https://www.semanticscholar.org/product/api), [tutorial](https://www.semanticscholar.org/product/api/tutorial), and [license](https://www.semanticscholar.org/product/api/license). | “Influential” is a model-derived feature, not ground truth. License prohibits bypassing limits. Coverage varies by field. |
| Crossref | DOI, ORCID/ROR where deposited; publisher metadata, references count, funders, updates/retractions, `is-referenced-by-count` | Public API without registration; identify with `mailto` for polite pool. As of this snapshot public/polite single-record limits are 5/10 requests/sec with concurrency 1/3; list limits are stricter, and Plus is paid. Read headers. [Access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) and [tips](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/). | Depositor-supplied metadata can be incomplete; reference/citation coverage is not universal. A DOI identifies the registered object, not necessarily every preprint/version. |
| DataCite | DOIs for datasets/software/reports, creators, related identifiers, citations/usage where available | Public REST/GraphQL; useful for non-journal research objects and software/dataset credit. [DataCite APIs](https://support.datacite.org/docs/api). | Relationship quality depends on deposits; citation graph differs from Crossref/OpenAlex. |
| ORCID | researcher identity and self/organization-asserted works/employment | Public API is free with registration; member API adds capabilities. [ORCID public API](https://info.orcid.org/documentation/features/public-api/). | ORCID records are user-controlled, variably complete, and should not be treated as verified employment unless assertion provenance supports it. |
| Unpaywall | OA status and locations keyed by DOI | Free API with email; monthly data snapshots. [Unpaywall API](https://unpaywall.org/products/api). | OA is availability, not quality. |
| Retraction Watch/Crossref updates | retractions, corrections, expressions of concern | Obtain through licensed/openly provided feeds and Crossref update relationships. | Absence is not proof of no concern; corrections propagate slowly. |
| Scopus/Web of Science/Dimensions/Lens | proprietary citation/field-normalized metrics, grants, patents, clinical links | Paid/institutional APIs with contract-specific quotas and redistribution rights. | Stronger curated coverage in some fields but opaque/contract-limited; never mix counts without source dimension. |

**Paper features worth ranking:** field/year-normalized citation percentile; 1/2/5-year citation velocity; influential citations; reference diversity; independent citations excluding self/coauthor/organization; citations from high-quality surveys, standards, production repositories, patents or follow-on benchmarks; reproducibility artifacts; code/data availability; benchmark survival; venue/selectivity only as a weak prior; corrections/retractions; and teaching value.

Do not reward age twice. Compare citations within field, document type, and publication-year cohort, and use a Bayesian/empirical prior for new works. Citations can be negative, ceremonial, self-cited, paper-mill-generated, or driven by survey visibility. Citation rings, author ambiguity, venue bias, English-language bias, and “sneaked references” require anomaly flags and cross-source agreement.

### 4.4 Talks, videos, podcasts, and reports

**YouTube Data API.** Key on YouTube video/channel IDs. `videos.list(part=statistics,snippet,contentDetails,status&id=...)` yields public views, likes, comments, duration, publish time, tags/category, and captions availability; dislikes are owner-only and favorites are deprecated. Channel statistics include subscribers (which can be hidden/rounded depending on exposure), views, and video count. [Video resource](https://developers.google.com/youtube/v3/docs/videos).

The official API requires a Google Cloud project/key; OAuth is needed for private/owner data. At this snapshot the API uses granular quota buckets: `search.list` has a default 100 calls/day, while common reads such as `videos.list` cost one unit in the broader 10,000-unit daily bucket. The quota model changed in June 2026, so consult the [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) rather than preserving old “search costs 100” assumptions. Batch IDs in lookup calls and cache immutable metadata.

YouTube Analytics API is owner-authorized and supplies watch time, average percentage viewed, retention, traffic sources, geography, impressions and click-through rate. These are far more meaningful than views but unavailable for arbitrary third-party videos. Never score creators with owner analytics in the same missing-data regime as public videos.

YouTube history is not provided for arbitrary videos: store daily counters. Definition changes matter—Shorts view counting changed on 2025-03-31. Reuploads split attention, deleted videos disappear, embedded autoplay and promotion can inflate views, and subscriber scale drives exposure. Use engagement rates with uncertainty and age/channel-size cohorts; comments can be disabled and like counts hidden.

**Other media/report sources:**

- Vimeo API: plays/likes/comments and owner analytics subject to plan/auth; use Vimeo video ID.
- Podcast Index API (open index) and Apple/Spotify owner dashboards: episode metadata is discoverable, but reliable play/completion counts are generally owner-only. RSS GUID + feed URL is the practical identity pair.
- Conference sites, Slideshare, Speaker Deck, Internet Archive, Zenodo, Figshare and institutional repositories: collect canonical URL/DOI, speaker, venue/date, views/downloads where officially exposed, version, transcript/slides, citations and backlinks. Metrics are not cross-platform comparable.
- Reports with DOI: route through Crossref/DataCite/OpenAlex. Reports without DOI: hash canonical PDF, capture publisher URL, report number, authors, date, version, backlinks, citations, and downstream references in standards/repos.
- Firecrawl/Tavily can discover conference pages, transcripts, mirrors, backlinks and mentions. Store the canonical source and extraction timestamp. Search rank or number of search hits is not a stable metric.

### 4.5 X, Hacker News, Reddit, and developer communities

#### X API versus xAI API

These are separate products and credentials:

- **X API** (`api.x.com`/developer platform) is the authoritative structured source for post/user IDs, public post metrics, follower counts, timelines, search, and conversation data. Access is pay-per-use/tier-dependent; endpoint limits are shown in the developer console and headers. For example, current tables define per-app/per-user 15-minute windows for lookup endpoints. Consult [X rate limits](https://docs.x.com/x-api/fundamentals/rate-limits) and [usage/billing](https://docs.x.com/x-api/fundamentals/usage-and-billing).
- **xAI API** (`api.x.ai`) runs Grok and optional agent tools. `XAI_API_KEY` is not an X developer bearer token and must not be assumed to authorize deterministic X API calls. Grok search can discover or summarize current X/web material and return citations, but it is a probabilistic retrieval/synthesis layer, not a complete analytics feed. Use it for candidate discovery and qualitative context; resolve cited post URLs/IDs through authorized X API access before asserting exact metrics. See [xAI web search](https://docs.x.ai/developers/tools/web-search) and the xAI X-search tool documentation available from its current docs index.

For X, collect post ID, author ID, created time, conversation ID, public reply/repost/quote/like/bookmark/impression metrics when returned by the purchased access level, follower/following/listed/post counts, and referenced posts. Persist daily snapshots. Some metrics are private/owner-only. Deleted/suspended/protected accounts, changed API tiers, bots, bought followers, coordinated engagement, celebrity/employer amplification, quote criticism, and viral posts make raw totals unreliable. Prefer topic-relevant engagement from credible, non-duplicate accounts; log-scale; normalize by age and audience; score sustained recurrence over one-off virality.

#### Hacker News

The [official Firebase API](https://github.com/HackerNews/API) is free, near-real-time, requires no key, and currently states no rate limit. IDs are durable item/user IDs. It exposes item score, descendants/comment tree, submitter, time, URL/title/text and top/new/best lists; user records expose karma and submissions. Build story snapshots because score/rank history is not supplied. The public BigQuery HN dataset is useful for historical analysis but may lag and should be provenance-labeled.

HN score is community resonance, not universal adoption. Ranking algorithm, time-of-day, title framing, duplicate submissions, domain familiarity and audience demographics dominate exposure. Use topic relevance, comment depth/quality, unique expert participants, persistence, and downstream links; do not infer approval from comment count.

#### Reddit

Reddit requires OAuth and approval for the Data API. Public post/comment IDs, score, upvote ratio (fuzzed/approximate), comment counts, awards, timestamps, subreddit and author signals are potentially useful. API access and rates are policy-dependent; read returned headers. The 2026 [Data API guidance](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) warns legacy docs may be out of date.

The [Data API Terms](https://redditinc.com/policies/data-api-terms) require a separate agreement for commercial purposes, research beyond allowed limits, or unpermitted uses; they restrict retention and prohibit using user content to train AI without rightsholder permission. Do not scrape around denied access, use Pushshift as a policy bypass, or retain deleted personal content. For this system, Reddit-derived quantitative features should remain disabled until the use case, storage/erasure process, and commercial agreement are approved.

Scores are fuzzed and can change; brigading, subreddit norms, moderation/removal, reposts, and audience size bias comparisons. Normalize inside subreddit/topic/time cohorts and distinguish sentiment from volume.

#### Stack Overflow/Stack Exchange

The official v2.3 API exposes question/answer scores, views, accepted answers, tags, reputation, badges and reputation history. A registered key typically has 10,000 requests/day; semantically identical requests faster than once/minute are abusive, and more than 30 requests/sec/IP is treated harshly. Respect the response `backoff` field. [API docs](https://api.stackexchange.com/docs) and [throttles](https://api.stackexchange.com/docs/throttle).

Useful library/engineer signals include tag-specific accepted answers, answer longevity, score after age normalization, edits/maintenance, and link references. Reputation is platform-local and older answers compound exposure; outdated accepted answers are common.

### 4.6 Organizations and software products

No single provider measures “product quality.” Use a layered company/product graph.

| Source | Metrics/use | Access and caveats |
|---|---|---|
| Official site/docs/changelog/status page | pricing, product surface, release cadence, deprecations, incidents, docs depth, integrations, security/compliance claims | Firecrawl can extract and monitor public pages, but retain canonical URLs/screenshots/hashes. Claims are vendor-authored; classify as `claimed`, not independently verified. Respect robots/terms and do not bypass access controls. |
| GitHub + registries + HF | OSS adoption, releases, contributors, issues, dependents, downloads | Best public product engineering signals; identity-map all repos/packages belonging to product before aggregation. Beware mirrors and portfolio size. |
| Product Hunt | launches, votes, comments, makers, launch date | Official GraphQL API; per app, currently 6,250 complexity points/15 min for GraphQL and 450 requests/15 min for other v2 endpoints. [Rate limits](https://api.producthunt.com/v2/docs/rate_limits/headers). Launch votes are campaign- and audience-driven. |
| Crunchbase | org identity, funding rounds, investors, acquisitions, people, categories | Licensed API. Basic exposes limited organization search/lookup/autocomplete; most fields/endpoints require Advanced/Commercial licensing. [Basic API](https://data.crunchbase.com/docs/crunchbase-basic-using-api). Funding is capacity/market signal, not product quality; coverage favors venture-backed firms. |
| Similarweb | estimated visits, unique visitors, geography, engagement, referrals/search; time series | Paid subscription/API add-on using data credits; REST is currently capped at 10 requests/sec. Metrics are modeled estimates, especially weak for small/niche domains, subdomains, APIs and desktop apps. [API](https://developers.similarweb.com/docs/similarweb-web-traffic-api) and [traffic fields](https://docs.similarweb.com/api-v5/similarweb-api/website-analysis-api/website-performance/traffic-and-engagement). |
| G2 | category/product IDs, review count/rating, category positioning, review content via licensed API | Official API is commercial/custom. G2's current terms explicitly prohibit automated scraping/collection and ML use without written consent. Use only licensed API fields under the contract. [G2 API](https://documentation.g2.com/docs/g2-api) and [terms](https://legal.g2.com/terms-of-use). Reviews have solicitation, customer-size, recency and survivorship bias. |
| App Store/Google Play | rating, review count, version, update date, rank, installs where exposed | Apple Search API/RSS and Google-authorized developer APIs have different public/owner scopes. Google Play public install bands are coarse; scraping is brittle and policy-sensitive. Prefer licensed providers or owner-authorized APIs. |
| SEC/Companies House/EDGAR and official filings | legal identity, revenue/R&D/headcount/risk statements for public firms | Official/free, event/quarterly; XBRL/company facts are structured. Subsidiary/product allocation is difficult and filings lag. [SEC data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). |
| Job postings/careers | hiring velocity, role mix, technologies, locations | Use official careers/ATS APIs/pages under their terms; snapshot counts. Reposts, evergreen roles, hiring freezes and ghost jobs distort inference. Never infer individual employment from scraped personal data. |
| Statuspage/incident sources | uptime incidents, severity/duration, responsiveness | Atlassian Statuspage often exposes public JSON APIs; product-specific. Vendor classification may understate severity. |
| Security advisories/CVE/OSV | vulnerabilities, affected versions, remediation lag | OSV API is open; NVD has key/rate policies. Vulnerability count tracks scrutiny and exposure as much as safety; normalize by age, surface and severity. [OSV API](https://google.github.io/osv.dev/api/). |

Other paid sources—PitchBook, Tracxn, Dealroom, LinkedIn, BuiltWith, Wappalyzer, Sensor Tower/data.ai, Semrush and Similarweb—can add funding, headcount, installed technologies, mobile usage and traffic. Treat every contract as a distinct data license with explicit storage, derivation, display and model-training rights. LinkedIn scraping/automation is particularly high-risk; do not use credentials to automate it without an approved official product and legal review.

## 5. Historical data strategy

Providers rarely give the history needed for velocity and durability. Implement three layers:

1. **Current snapshot collectors:** daily cumulative counters and current metadata.
2. **Event collectors:** webhooks, GitHub events, registry catalogs/RSS, Crossref updates, changelogs.
3. **Backfills:** provider dumps (OpenAlex/S2), PyPI BigQuery, GH Archive, Stack Exchange data dump, HN BigQuery, SEC submissions/company facts.

Store raw immutable payloads in an access-controlled object store when the license permits it, plus normalized observations in the warehouse. A deletion/takedown ledger must propagate source deletions and license requirements. For social/user-generated content, minimize stored text: prefer IDs, aggregates, derived non-reversible features, and a rehydration check before display.

Use temporal leakage controls: course/research evaluation at date `T` can only use observations whose `as_of <= T`. Otherwise a retrospective citation/download count makes an old recommendation system appear prescient.

## 6. Feature construction and anti-gaming rules

### 6.1 Transform before combining

- Use `log1p` for heavy-tailed counts.
- Compute 7/30/90-day deltas from snapshots; attach uncertainty when observations are missing.
- Normalize by entity type, ecosystem, topic, age cohort, organization/channel size and visibility.
- Apply source coverage weights and explicit missingness indicators; no missing-as-zero.
- Separate stock (all-time stars) from flow (30-day star growth) and quality/outcomes (dependent retention, issue resolution, citations by strong follow-on work).
- Deduplicate mirrors, forks, paper versions, video reuploads, package aliases and organization portfolios before aggregation.
- Use winsorization/caps so one viral metric cannot dominate.
- Version metric definitions. Platform counting changes create breakpoints, not genuine growth.

### 6.2 Cross-signal anomaly flags

Flag, do not automatically punish:

- abrupt follower/star/vote bursts without corresponding downloads, dependents, discussion, or contributor growth;
- large downloads with no dependents (CI, mirrors, resolver behavior, bundled/transitive use);
- high citations concentrated in the same authors/venue or references with no substantive citation context;
- high views with unusually low watch/engagement where owner analytics is available;
- review bursts, duplicate language, reviewer-company concentration or incentive campaigns;
- commit volume dominated by bots/generated files or one monorepo migration;
- organization totals dominated by one acquired project or fork network.

All anomaly outputs require evidence fields and appeal/manual-review state. Avoid public accusations based on statistical flags.

### 6.3 Recommended metric families for downstream agents

| Family | Examples | Why curriculum/research agents need it |
|---|---|---|
| Authority | influential/independent citations, respected dependents, tag-specific accepted answers | Find credible teachers and foundations |
| Adoption | direct dependents, active production repos, package/model pulls, customer/review evidence | Distinguish practiced technology from discourse |
| Momentum | cohort-normalized 30/90-day growth, new contributors, citation/download velocity | Detect emerging topics |
| Durability | multi-year activity, retained dependents, maintained docs, stable releases | Avoid building courses on transient hype |
| Quality/health | issue response, maintainer diversity, security remediation, reproducibility | Assess whether learners can safely rely on it |
| Pedagogy | transcript/docs/examples, conceptual coverage, exercises, clarity/engagement evidence | Rank teaching sources separately from technical importance |
| Novelty | first appearance of capability/taxonomy edge, citation/repo temporal precedence | Choose deep-research targets |
| Risk | license, retraction, abandonment, concentration, anomaly and policy flags | Gate recommendations and disclose uncertainty |

## 7. Collector rollout

### Phase 1 — official/open, high confidence

1. GitHub REST/GraphQL using the existing token, with ETag caching and rate headers.
2. npm, PyPI JSON + BigQuery/pypistats, crates.io, NuGet, Maven Central, RubyGems, Packagist, Docker Hub, Hugging Face.
3. OpenAlex + Crossref + Semantic Scholar, DOI/ORCID/ROR reconciliation, retraction/update links.
4. YouTube public statistics using a dedicated Google API key; HN official API; Stack Exchange API.
5. Official docs/changelogs/status/CVE/SEC collectors via canonical pages/APIs.

### Phase 2 — history and owner opt-ins

1. Daily snapshots; GH Archive/PyPI/OpenAlex/S2 backfills.
2. GitHub traffic and YouTube Analytics for owners who explicitly authorize access.
3. Webhooks and change monitors for releases/docs/incidents.

### Phase 3 — licensed enrichment

Evaluate Similarweb, Crunchbase, G2 and mobile/app intelligence against a written procurement matrix: coverage, estimation method, historical depth, refresh lag, API quotas, bulk export, deletion support, internal-derived-feature rights, external display rights, and ML/training restrictions.

Keep X and Reddit quantitative ingestion behind an `access_and_legal_approved` feature flag. `XAI_API_KEY` may power discovery/context now, but it is not a substitute for X API authorization. Reddit requires an approved use case/agreement before this project's likely commercial research pipeline ingests user content.

## 8. Minimum acceptance tests for every connector

- Resolve one known entity by canonical ID and one renamed/aliased entity.
- Reject an ambiguous name-only match.
- Capture counter, `as_of`, raw hash, ETag, quota headers and policy/source URL.
- Re-run conditionally and demonstrate `304` or idempotent equivalent where supported.
- Handle `429`, `403`, `404`, `202`, pagination and partial fields without converting to zero.
- Demonstrate a delta from two fixtures, including a counter decrease.
- Demonstrate deletion/tombstone propagation.
- Confirm secret redaction in logs and fixtures.
- Test provider definition changes with a versioned fixture.
- Record license/access tier and block export when rights do not permit it.

## 9. Practical examples

The following requests are patterns; environment variables must be read by the collector and redacted from logs.

```bash
# GitHub repository snapshot
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/langchain-ai/langchain

# npm 30-day downloads (public downloads service; preserve URL and observed headers)
curl -sS "https://api.npmjs.org/downloads/point/last-month/langchain"

# PyPI canonical project metadata
curl -sS "https://pypi.org/pypi/langchain/json"

# OpenAlex paper lookup by DOI (send configured API key according to current docs)
curl -sS "https://api.openalex.org/works/https://doi.org/10.48550/arXiv.1706.03762?api_key=$OPENALEX_API_KEY"

# Crossref polite lookup
curl -sS "https://api.crossref.org/works/10.48550/arXiv.1706.03762?mailto=research@example.org"

# Semantic Scholar multi-ID lookup
curl -sS -H "x-api-key: $SEMANTIC_SCHOLAR_API_KEY" \
  "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762?fields=title,year,citationCount,influentialCitationCount,authors"

# Hacker News item
curl -sS "https://hacker-news.firebaseio.com/v0/item/8863.json"
```

For production, use provider SDKs only when they expose headers, pagination and retries; otherwise a thin HTTP connector is easier to audit. The sample email above must be replaced with a monitored project contact.

## 10. Decision record

- **Use first:** official public APIs and open data dumps; they provide reproducible identifiers and the clearest rights.
- **Use as discovery only:** Grok/xAI, Firecrawl and Tavily outputs until each claimed metric is resolved to its canonical source.
- **Purchase selectively:** web/app estimates, company data and review datasets only when they materially improve a ranking decision and their license permits the downstream product.
- **Do not acquire by circumvention:** G2, LinkedIn, Reddit, X, protected/private analytics, or any service that denies automated access. Missing data is preferable to an unlawful or irreproducible metric.
- **Score behaviors, not fame:** combine independent adoption, contribution quality, durability, teaching value and risk inside appropriate cohorts. Keep every raw metric explainable and source-visible.
