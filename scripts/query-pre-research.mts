import { loadEnv } from "./load-env.mjs";
import { getPostgresPool, query } from "../agent/lib/postgres";
import {
  downloadObject,
  listObjectsRecursive,
  objectExists,
  type ListedStorageObject,
} from "../agent/lib/supabase-storage";
import { INTENT_BUCKET } from "../contracts/enums";
import { sha256Hex } from "../lib/hash";

loadEnv();

const TRANSCRIPT_BUCKET = "ai-engineer-transcripts";
const TRANSCRIPT_PREVIEW_CHARS = 280;

type CliOptions = {
  videoId: string;
  runId?: string;
  json: boolean;
  includeTranscript: boolean;
  includeArtifacts: boolean;
};

function printUsage(): void {
  console.error(`Usage:
  npm run query:pre-research -- --video-id <youtube_id> [--run-id <uuid>]
  npm run query:pre-research -- --video-id=-rsTkYgnNzM

Options:
  --video-id, --video   YouTube video id (required; use --video-id=ID when the id starts with -)
  --run-id              Specific pre-research run (defaults to latest for the video)
  --json                Print the full structured payload instead of the verification report
  --include-transcript  Include full transcript text in --json output
  --include-artifacts   Download packet JSON bodies from research-ingestion-intents
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> & { json: boolean; includeTranscript: boolean; includeArtifacts: boolean } = {
    json: false,
    includeTranscript: false,
    includeArtifacts: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-transcript") {
      options.includeTranscript = true;
      continue;
    }
    if (arg === "--include-artifacts") {
      options.includeArtifacts = true;
      continue;
    }
    if (arg === "--video-id" || arg === "--video") {
      options.videoId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--video-id=")) {
      options.videoId = arg.slice("--video-id=".length);
      continue;
    }
    if (arg === "--run-id") {
      options.runId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length);
      continue;
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(arg) && !options.videoId) {
      options.videoId = arg;
    }
  }

  if (!options.videoId) {
    printUsage();
    process.exit(2);
  }

  return options as CliOptions;
}

function previewText(value: string | null | undefined, max = 220): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function asIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

async function one<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

async function fetchStorageObject(options: {
  bucket: string;
  path: string;
  includeBody: boolean;
  parseJson?: boolean;
}): Promise<{
  bucket: string;
  path: string;
  exists: boolean;
  byte_count: number | null;
  sha256: string | null;
  preview: string | null;
  text: string | null;
  json: unknown;
  error: string | null;
}> {
  const exists = await objectExists({ bucket: options.bucket, path: options.path });
  if (!exists) {
    return {
      bucket: options.bucket,
      path: options.path,
      exists: false,
      byte_count: null,
      sha256: null,
      preview: null,
      text: null,
      json: null,
      error: null,
    };
  }

  try {
    const body = await downloadObject({ bucket: options.bucket, path: options.path });
    let json: unknown = null;
    if (options.parseJson) {
      json = JSON.parse(body) as unknown;
      if (!options.includeBody) {
        json = summarizeArtifact(json);
      }
    }
    return {
      bucket: options.bucket,
      path: options.path,
      exists: true,
      byte_count: Buffer.byteLength(body, "utf8"),
      sha256: sha256Hex(body),
      preview: previewText(body, TRANSCRIPT_PREVIEW_CHARS),
      text: options.includeBody && !options.parseJson ? body : null,
      json,
      error: null,
    };
  } catch (error) {
    return {
      bucket: options.bucket,
      path: options.path,
      exists: true,
      byte_count: null,
      sha256: null,
      preview: null,
      text: null,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeArtifact(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of [
    "schema_version",
    "run_id",
    "video_id",
    "research_as_of",
    "status",
    "analysis_id",
    "intent_id",
    "artifact_count",
    "packet_storage_prefix",
  ]) {
    if (record[key] !== undefined) summary[key] = record[key];
  }
  if (Array.isArray(record.families)) summary.family_count = record.families.length;
  if (Array.isArray(record.candidates)) summary.candidate_count = record.candidates.length;
  if (Array.isArray(record.sources)) summary.source_count = record.sources.length;
  if (Array.isArray(record.operations)) summary.operation_count = record.operations.length;
  if (Array.isArray(record.resources)) summary.resource_count = record.resources.length;
  if (Array.isArray(record.entities)) summary.entity_count = record.entities.length;
  if (record.primary_featured_organization && typeof record.primary_featured_organization === "object") {
    const org = record.primary_featured_organization as Record<string, unknown>;
    summary.primary_featured_organization = org.canonical_name ?? null;
  }
  if (typeof record.transcript_summary === "string") {
    summary.transcript_summary = previewText(record.transcript_summary, 280);
  }
  if (typeof record.initial_summary === "string") {
    summary.initial_summary = previewText(record.initial_summary, 280);
  }
  return summary;
}

async function queryPreResearch(options: CliOptions) {
  const video = await one<{
    video_id: string;
    title: string;
    description: string | null;
    published_at: Date | string | null;
    channel_id: string | null;
    channel_handle: string | null;
    channel_title: string | null;
    duration: string | null;
    duration_seconds: number | null;
    url: string | null;
    transcript_status: string;
    transcript_bucket: string | null;
    transcript_path: string | null;
    transcript_language: string | null;
    transcript_char_count: number | null;
    transcript_fetched_at: Date | string | null;
  }>(
    `select
       video_id, title, description, published_at, channel_id, channel_handle, channel_title,
       duration, duration_seconds, url, transcript_status, transcript_bucket, transcript_path,
       transcript_language, transcript_char_count, transcript_fetched_at
     from public.research_starter_videos
     where video_id = $1`,
    [options.videoId],
  );

  if (!video) {
    return { ok: false as const, error: `VIDEO_NOT_FOUND: ${options.videoId}` };
  }

  const [videoState, runs] = await Promise.all([
    one<Record<string, unknown>>(
      `select
         video_id, transcript_sha256, eligibility_status, ineligibility_reasons, duration_seconds,
         transcript_object_exists, evaluated_at, latest_run_id, pipeline_status,
         pre_research_pipeline_finished, pre_research_pipeline_finished_at,
         finished_transcript_sha256, finished_intent_id, created_at, updated_at
       from public.research_pre_research_video_state
       where video_id = $1`,
      [options.videoId],
    ),
    query<Record<string, unknown>>(
      `select
         run_id, video_id, status, attempt, transcript_sha256, prompt_bundle_version, model_id,
         research_as_of, packet_schema_version, packet_storage_prefix, packet_sha256,
         research_session_id, synthesis_session_id, research_completed_at, synthesis_started_at,
         workflow_session_id, started_at, completed_at, error_code, error_detail,
         intent_path, intent_sha256, created_at, updated_at
       from public.research_pre_research_run
       where video_id = $1
       order by created_at desc`,
      [options.videoId],
    ),
  ]);

  const selectedRun =
    (options.runId ? runs.find((run) => String(run.run_id) === options.runId) : null) ??
    (videoState?.latest_run_id
      ? runs.find((run) => String(run.run_id) === String(videoState.latest_run_id))
      : null) ??
    runs[0] ??
    null;

  if (options.runId && !selectedRun) {
    return { ok: false as const, error: `RUN_NOT_FOUND: ${options.runId}` };
  }

  const runId = selectedRun ? String(selectedRun.run_id) : null;
  const analysis = runId
    ? await one<Record<string, unknown>>(
        `select
           analysis_id, run_id, video_id, initial_summary, structured_summary,
           contextualized_abstract, why_it_matters, key_takeaways, concepts, prerequisites,
           learning_outcomes, limitations, quantitative_claims, demonstrations,
           curriculum_roles, challenge_seeds, difficulty, content_form, evidence_level,
           overall_confidence, generated_at
         from public.research_video_analysis
         where run_id = $1`,
        [runId],
      )
    : null;
  const analysisId = analysis ? String(analysis.analysis_id) : null;

  const [
    sessions,
    intent,
    artifacts,
    webSearches,
    initialSummary,
    technologySummaries,
    categories,
    domains,
    lifecycle,
    organizations,
    entities,
    resources,
    evidenceAnchors,
  ] = await Promise.all([
    runId
      ? query<Record<string, unknown>>(
          `select
             pre_research_session_id, run_id, phase, attempt, eve_session_id, status,
             started_at, completed_at, error_code, error_detail, result_summary
           from public.research_pre_research_session
           where run_id = $1
           order by phase, attempt`,
          [runId],
        )
      : Promise.resolve([]),
    runId
      ? one<Record<string, unknown>>(
          `select
             intent_id, run_id, video_id, schema_version, idempotency_key, storage_bucket,
             storage_path, content_sha256, status, validated_at, applied_at, rejected_at,
             error_detail, created_at
           from public.research_ingestion_intent
           where run_id = $1`,
          [runId],
        )
      : Promise.resolve(null),
    runId
      ? query<Record<string, unknown>>(
          `select
             artifact_id, run_id, intent_id, artifact_kind, schema_version, storage_bucket,
             storage_path, content_sha256, byte_count, created_at
           from public.research_pre_research_artifact
           where run_id = $1
           order by artifact_kind`,
          [runId],
        )
      : Promise.resolve([]),
    runId
      ? query<Record<string, unknown>>(
          `select
             search_event_id, run_id, subagent, query, provider, searched_at,
             result_urls, selected_urls, search_purpose
           from public.research_web_search_event
           where run_id = $1
           order by searched_at`,
          [runId],
        )
      : Promise.resolve([]),
    analysisId
      ? one<Record<string, unknown>>(
          `select
             analysis_id, video_id, transcript_summary, software_engineering_concepts,
             ai_concepts, external_context_notes, temporal_context, research_as_of,
             evidence_ids, generated_at
           from public.research_video_initial_summary
           where analysis_id = $1`,
          [analysisId],
        )
      : Promise.resolve(null),
    analysisId
      ? query<Record<string, unknown>>(
          `select
             technology_summary_id, analysis_id, video_id, family_rank, family_label,
             primary_technology, primary_technology_kind, related_technologies, implementations,
             summary, relationship_rationale, role_in_video, current_status, temporal_status,
             video_published_at, research_as_of, official_urls, evidence_ids, confidence,
             generated_at
           from public.research_video_technology_summary
           where analysis_id = $1
           order by family_rank`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select analysis_id, category_code, assignment_role, confidence, rationale, alternative_rank
           from public.research_video_category
           where analysis_id = $1
           order by assignment_role, alternative_rank nulls last, category_code`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select analysis_id, domain_code, confidence, rationale
           from public.research_video_domain
           where analysis_id = $1
           order by confidence desc, domain_code`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select analysis_id, lifecycle_stage
           from public.research_video_lifecycle
           where analysis_id = $1
           order by lifecycle_stage`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select
             organization_candidate_id, analysis_id, video_id, canonical_name, normalized_name,
             organization_scope, relationship_roles, is_primary_featured, featured_rank,
             primary_domain_code, secondary_domain_codes, parent_name, parent_canonical_url,
             official_url, authoritative_summary, relationship_to_implementation, current_status,
             status_as_of, video_time_name, video_time_parent_name, ownership_changed_since_video,
             confidence, evidence_ids, generated_at
           from public.research_organization_candidate
           where analysis_id = $1
           order by featured_rank`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select
             candidate_id, analysis_id, entity_kind, name, normalized_name, canonical_url,
             organization_name, relationship_to_video, confidence, verification_status, evidence_ids
           from public.research_entity_candidate
           where analysis_id = $1
           order by entity_kind, name`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select
             resource_candidate_id, analysis_id, resource_type, title, url, normalized_url,
             publisher, relationship_to_video, why_valuable, verification_status, is_first_party,
             license, confidence, evidence_ids
           from public.research_resource_candidate
           where analysis_id = $1
           order by resource_type, title`,
          [analysisId],
        )
      : Promise.resolve([]),
    analysisId
      ? query<Record<string, unknown>>(
          `select
             evidence_id, analysis_id, source_kind, source_url, transcript_segment,
             start_seconds, end_seconds, start_character, end_character, short_excerpt, supports
           from public.research_evidence_anchor
           where analysis_id = $1
           order by start_character nulls last, evidence_id`,
          [analysisId],
        )
      : Promise.resolve([]),
  ]);

  const organizationIds = organizations.map((org) => String(org.organization_candidate_id));
  const organizationSources =
    organizationIds.length > 0
      ? await query<Record<string, unknown>>(
          `select
             s.organization_source_id, s.organization_candidate_id, c.canonical_name,
             s.source_rank, s.source_role, s.authority_tier, s.title, s.publisher, s.url,
             s.normalized_url, s.publicly_retrievable, s.retrieved_at, s.source_published_at,
             s.supports, s.verification_status, s.is_required_core_source, s.evidence_id
           from public.research_organization_source s
           join public.research_organization_candidate c
             on c.organization_candidate_id = s.organization_candidate_id
           where s.organization_candidate_id = any($1::uuid[])
           order by c.featured_rank, s.source_rank`,
          [organizationIds],
        )
      : [];

  const intentEvents = intent
    ? await query<Record<string, unknown>>(
        `select
           event_id, intent_id, operation_index, operation_kind, status,
           affected_table, affected_key, error_detail, created_at
         from public.research_ingestion_intent_event
         where intent_id = $1
         order by operation_index`,
        [intent.intent_id],
      )
    : [];

  const storageObjects = await query<{
    bucket_id: string;
    name: string;
    created_at: Date | string | null;
    updated_at: Date | string | null;
    size: string | number | null;
  }>(
    `select
       bucket_id, name, created_at, updated_at,
       (metadata->>'size')::bigint as size
     from storage.objects
     where (
       bucket_id = $1
       and (
         name = $2
         or name like $3
       )
     ) or (
       bucket_id = $4
       and name like $5
     )
     order by bucket_id, name`,
    [
      video.transcript_bucket ?? TRANSCRIPT_BUCKET,
      video.transcript_path,
      `%/${options.videoId}.%`,
      INTENT_BUCKET,
      `pre-research/%/${options.videoId}/%`,
    ],
  );

  const transcriptPath = video.transcript_path;
  const transcriptBucket = video.transcript_bucket ?? TRANSCRIPT_BUCKET;
  const packetPrefix =
    (selectedRun?.packet_storage_prefix as string | null) ??
    (runId ? `pre-research/v2/${options.videoId}/${runId}` : `pre-research/v2/${options.videoId}`);

  const [transcriptObject, intentListing, transcriptListing] = await Promise.all([
    transcriptPath
      ? fetchStorageObject({
          bucket: transcriptBucket,
          path: transcriptPath,
          includeBody: options.includeTranscript,
        })
      : Promise.resolve(null),
    listObjectsRecursive({ bucket: INTENT_BUCKET, prefix: `pre-research/v2/${options.videoId}` }).catch(
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    ),
    listObjectsRecursive({
      bucket: transcriptBucket,
      prefix: transcriptPath ? transcriptPath.split("/").slice(0, -1).join("/") : "ai-dot-engineer",
    }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })),
  ]);

  const listedIntentObjects = Array.isArray(intentListing) ? intentListing : [];
  const listedTranscriptObjects = Array.isArray(transcriptListing)
    ? listedTranscriptObjectsForVideo(transcriptListing, options.videoId, transcriptPath)
    : [];

  const artifactRetrievals = await Promise.all(
    artifacts.map(async (artifact) => {
      const retrieved = await fetchStorageObject({
        bucket: String(artifact.storage_bucket),
        path: String(artifact.storage_path),
        includeBody: options.includeArtifacts,
        parseJson: true,
      });
      return {
        artifact_kind: artifact.artifact_kind,
        registered_sha256: artifact.content_sha256,
        registered_byte_count: artifact.byte_count,
        sha_matches:
          retrieved.sha256 != null && retrieved.sha256 === String(artifact.content_sha256),
        ...retrieved,
      };
    }),
  );

  const produced = {
    companies: organizations.map((org) => ({
      name: org.canonical_name,
      primary: org.is_primary_featured,
      rank: org.featured_rank,
      scope: org.organization_scope,
      roles: org.relationship_roles,
      domain: org.primary_domain_code,
      official_url: org.official_url,
      parent: org.parent_name,
      status: org.current_status,
      summary: previewText(String(org.authoritative_summary ?? ""), 240),
    })),
    libraries_and_technologies: technologySummaries.map((family) => ({
      rank: family.family_rank,
      family: family.family_label,
      technology: family.primary_technology,
      kind: family.primary_technology_kind,
      temporal_status: family.temporal_status,
      current_status: family.current_status,
      official_urls: family.official_urls,
      implementations: family.implementations,
      summary: previewText(String(family.summary ?? ""), 240),
    })),
    summaries: {
      transcript_only: previewText(String(analysis?.initial_summary ?? ""), 320),
      structured: previewText(String(analysis?.structured_summary ?? ""), 320),
      contextualized: previewText(
        String(initialSummary?.transcript_summary ?? analysis?.contextualized_abstract ?? ""),
        320,
      ),
      why_it_matters: previewText(String(analysis?.why_it_matters ?? ""), 240),
      temporal_context: previewText(String(initialSummary?.temporal_context ?? ""), 240),
    },
    taxonomy: {
      difficulty: analysis?.difficulty ?? null,
      content_form: analysis?.content_form ?? null,
      evidence_level: analysis?.evidence_level ?? null,
      categories: categories.map((row) => ({
        role: row.assignment_role,
        code: row.category_code,
        confidence: row.confidence,
      })),
      domains: domains.map((row) => ({
        code: row.domain_code,
        confidence: row.confidence,
      })),
      lifecycle: lifecycle.map((row) => row.lifecycle_stage),
    },
    entities: entities.map((row) => ({
      kind: row.entity_kind,
      name: row.name,
      url: row.canonical_url,
      status: row.verification_status,
    })),
    resources: resources.map((row) => ({
      type: row.resource_type,
      title: row.title,
      url: row.url,
      first_party: row.is_first_party,
      status: row.verification_status,
    })),
  };

  return {
    ok: true as const,
    video: {
      ...video,
      published_at: asIso(video.published_at),
      transcript_fetched_at: asIso(video.transcript_fetched_at),
      description: previewText(video.description, 400),
    },
    video_state: videoState,
    runs,
    selected_run: selectedRun,
    sessions,
    intent,
    intent_events: intentEvents,
    analysis,
    initial_summary: initialSummary,
    technology_summaries: technologySummaries,
    categories,
    domains,
    lifecycle,
    organizations,
    organization_sources: organizationSources,
    entities,
    resources,
    evidence_anchors: {
      count: evidenceAnchors.length,
      sample: evidenceAnchors.slice(0, 5).map((row) => ({
        evidence_id: row.evidence_id,
        source_kind: row.source_kind,
        supports: row.supports,
        excerpt: previewText(String(row.short_excerpt ?? ""), 180),
      })),
    },
    web_searches: webSearches,
    artifacts,
    produced,
    storage: {
      packet_prefix: packetPrefix,
      catalog_objects: storageObjects.map((row) => ({
        bucket: row.bucket_id,
        path: row.name,
        size: row.size,
        created_at: asIso(row.created_at),
        updated_at: asIso(row.updated_at),
      })),
      transcript: transcriptObject,
      transcript_listing: Array.isArray(transcriptListing)
        ? listedTranscriptObjects
        : { error: (transcriptListing as { error: string }).error },
      intent_listing: Array.isArray(intentListing)
        ? listedIntentObjects.filter((item) => !item.is_folder)
        : { error: (intentListing as { error: string }).error },
      artifact_retrievals: artifactRetrievals,
    },
  };
}

function listedTranscriptObjectsForVideo(
  items: ListedStorageObject[],
  videoId: string,
  transcriptPath: string | null,
): ListedStorageObject[] {
  return items.filter((item) => {
    if (item.is_folder) return false;
    if (transcriptPath && item.path === transcriptPath) return true;
    return item.path.includes(videoId);
  });
}

function line(label: string, value: unknown): void {
  const rendered =
    value == null || value === ""
      ? "—"
      : Array.isArray(value)
        ? value.length === 0
          ? "—"
          : value.join(", ")
        : String(value);
  console.log(`${label.padEnd(22)} ${rendered}`);
}

function section(title: string): void {
  console.log("");
  console.log(`== ${title} ==`);
}

function printReport(payload: Awaited<ReturnType<typeof queryPreResearch>>): void {
  if (!payload.ok) {
    console.error(payload.error);
    return;
  }

  section("Video");
  line("video_id", payload.video.video_id);
  line("title", payload.video.title);
  line("published_at", payload.video.published_at);
  line("duration", `${payload.video.duration ?? "—"} (${payload.video.duration_seconds ?? "?"}s)`);
  line("url", payload.video.url);
  line("transcript_status", payload.video.transcript_status);
  line("transcript_path", `${payload.video.transcript_bucket}/${payload.video.transcript_path}`);
  line("transcript_chars", payload.video.transcript_char_count);

  section("Pipeline");
  line("eligibility", payload.video_state?.eligibility_status);
  line(
    "ineligible_because",
    Array.isArray(payload.video_state?.ineligibility_reasons)
      ? payload.video_state.ineligibility_reasons
      : null,
  );
  line("pipeline_status", payload.video_state?.pipeline_status);
  line("finished", payload.video_state?.pre_research_pipeline_finished);
  line("finished_at", asIso(payload.video_state?.pre_research_pipeline_finished_at));
  line("latest_run_id", payload.video_state?.latest_run_id);
  line("run_count", payload.runs.length);
  line("selected_run", payload.selected_run?.run_id);
  line("run_status", payload.selected_run?.status);
  line("research_as_of", asDateOnly(payload.selected_run?.research_as_of));
  line("packet_prefix", payload.selected_run?.packet_storage_prefix);
  line("intent_status", payload.intent?.status);
  line("intent_id", payload.intent?.intent_id);
  line("sessions", payload.sessions.map((row) => `${row.phase}:${row.status}`).join(" | ") || "—");

  section("Summaries");
  console.log(`transcript-only: ${payload.produced.summaries.transcript_only ?? "—"}`);
  console.log(`contextualized:  ${payload.produced.summaries.contextualized ?? "—"}`);
  console.log(`why it matters:  ${payload.produced.summaries.why_it_matters ?? "—"}`);

  section("Taxonomy");
  line("form / difficulty", `${payload.produced.taxonomy.content_form} / ${payload.produced.taxonomy.difficulty}`);
  line("evidence_level", payload.produced.taxonomy.evidence_level);
  line(
    "categories",
    payload.produced.taxonomy.categories.map((row) => `${row.role}:${row.code} (${row.confidence})`),
  );
  line(
    "domains",
    payload.produced.taxonomy.domains.map((row) => `${row.code} (${row.confidence})`),
  );
  line("lifecycle", payload.produced.taxonomy.lifecycle);

  section("Companies");
  if (payload.produced.companies.length === 0) {
    console.log("none");
  } else {
    for (const company of payload.produced.companies) {
      console.log(
        `- ${company.primary ? "PRIMARY " : ""}${company.name} [${company.domain}] ${company.official_url}`,
      );
      console.log(`  roles=${Array.isArray(company.roles) ? company.roles.join(",") : company.roles} scope=${company.scope}`);
      console.log(`  ${company.summary ?? ""}`);
    }
  }

  section("Libraries / technologies");
  if (payload.produced.libraries_and_technologies.length === 0) {
    console.log("none");
  } else {
    for (const family of payload.produced.libraries_and_technologies) {
      console.log(`- #${family.rank} ${family.family} (${family.kind}, ${family.temporal_status})`);
      console.log(`  ${family.summary ?? ""}`);
    }
  }

  section("Entities / resources");
  line("entities", payload.produced.entities.map((row) => `${row.kind}:${row.name}`));
  line("resources", payload.produced.resources.map((row) => `${row.type}:${row.title}`));
  line("org sources", payload.organization_sources.length);
  line("evidence anchors", payload.evidence_anchors.count);
  line("web searches", payload.web_searches.length);
  line("intent events", payload.intent_events.length);

  section("Storage: ai-engineer-transcripts");
  if (payload.storage.transcript) {
    line("exists", payload.storage.transcript.exists);
    line("path", payload.storage.transcript.path);
    line("bytes", payload.storage.transcript.byte_count);
    line("sha256", payload.storage.transcript.sha256);
    line("run_sha256", payload.selected_run?.transcript_sha256);
    line(
      "sha_matches_run",
      payload.storage.transcript.sha256 != null &&
        payload.storage.transcript.sha256 === payload.selected_run?.transcript_sha256,
    );
    line("preview", payload.storage.transcript.preview);
  } else {
    console.log("no transcript path on catalog row");
  }

  section("Storage: research-ingestion-intents");
  line("packet_prefix", payload.storage.packet_prefix);
  const intentFiles = Array.isArray(payload.storage.intent_listing)
    ? payload.storage.intent_listing
    : [];
  line("listed_objects", intentFiles.length);
  for (const item of intentFiles) {
    const size =
      item.metadata && typeof item.metadata.size === "number" ? ` ${item.metadata.size}B` : "";
    console.log(`- ${item.path}${size}`);
  }
  if (!Array.isArray(payload.storage.intent_listing)) {
    console.log(`list error: ${payload.storage.intent_listing.error}`);
  }

  section("Artifact retrieval");
  if (payload.storage.artifact_retrievals.length === 0) {
    console.log("no registered artifacts");
  } else {
    for (const artifact of payload.storage.artifact_retrievals) {
      const mark = artifact.exists && artifact.sha_matches ? "ok" : artifact.exists ? "HASH_MISMATCH" : "MISSING";
      console.log(
        `- [${mark}] ${artifact.artifact_kind}  ${artifact.path}  ${artifact.byte_count ?? 0}B`,
      );
    }
  }

  section("Intent operations");
  for (const event of payload.intent_events) {
    console.log(
      `- ${event.operation_index} ${event.operation_kind} -> ${event.affected_table ?? "—"} (${event.status})`,
    );
  }
}

const options = parseArgs(process.argv.slice(2));

try {
  const payload = await queryPreResearch(options);
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printReport(payload);
  }
  if (!payload.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await getPostgresPool().end();
}
