import pg from "pg";

const LIVE_OR_APPLIED_STATUSES = [
  "queued",
  "claimed",
  "analyzing",
  "research_complete",
  "synthesizing",
  "intent_ready",
  "applying",
  "applied",
];
const CURRENT_PACKET_SCHEMA_VERSION = "2.0.0";

const CANONICAL_ELIGIBILITY_PREDICATES = `
  v.transcript_status = 'stored'
  and v.transcript_bucket = 'ai-engineer-transcripts'
  and v.transcript_path is not null
  and v.transcript_text is not null
  and length(btrim(v.transcript_text)) > 0
  and v.duration_seconds is not null
  and v.duration_seconds > 0
  and v.duration_seconds < 5400
  and exists (
    select 1
    from storage.objects o
    where o.bucket_id = v.transcript_bucket
      and o.name = v.transcript_path
  )
`;

const CURRENT_TRANSCRIPT_HASH = `encode(extensions.digest(v.transcript_text, 'sha256'), 'hex')`;

function liveOrAppliedPredicate() {
  return `
    exists (
      select 1
      from public.research_pre_research_run r
      where r.video_id = v.video_id
        and r.transcript_sha256 = ${CURRENT_TRANSCRIPT_HASH}
        and r.status::text = any($4::text[])
    )
  `;
}

function finishedPredicate() {
  return `
    exists (
      select 1
      from public.research_pre_research_video_state s_finished
      where s_finished.video_id = v.video_id
        and s_finished.pre_research_pipeline_finished
        and s_finished.finished_transcript_sha256 = ${CURRENT_TRANSCRIPT_HASH}
    )
  `;
}

async function stateTableExists(pool) {
  const { rows } = await pool.query(
    `select to_regclass('public.research_pre_research_video_state') is not null as exists`,
  );
  return Boolean(rows[0]?.exists);
}

function buildListQuery(hasStateTable) {
  const stateSelect = hasStateTable
    ? `
        s.ineligibility_reasons,
        s.pipeline_status,
        s.eligibility_status,
        s.pre_research_pipeline_finished
      `
    : `
        '{}'::text[] as ineligibility_reasons,
        null::text as pipeline_status,
        null::text as eligibility_status,
        false as pre_research_pipeline_finished
      `;
  const stateJoin = hasStateTable
    ? `left join public.research_pre_research_video_state s on s.video_id = v.video_id`
    : "";
  const occupancyFilter = hasStateTable
    ? `
        (
          $2::boolean
          or (
            not ${liveOrAppliedPredicate()}
            and not ${finishedPredicate()}
          )
        )
      `
    : `
        (
          $2::boolean
          or not ${liveOrAppliedPredicate()}
        )
      `;

  return `
    select
      v.video_id,
      v.title,
      v.published_at,
      v.duration_seconds,
      ${CURRENT_TRANSCRIPT_HASH} as transcript_sha256,
      v.transcript_status,
      v.transcript_bucket,
      v.transcript_path,
      v.transcript_char_count,
      exists (
        select 1
        from storage.objects o
        where o.bucket_id = v.transcript_bucket
          and o.name = v.transcript_path
      ) as storage_object_exists,
      ${liveOrAppliedPredicate()} as has_live_or_applied_run,
      ${stateSelect}
    from public.research_starter_videos v
    ${stateJoin}
    where ${CANONICAL_ELIGIBILITY_PREDICATES}
      and ($3::text is null or v.video_id = $3)
      and ${occupancyFilter}
    order by v.published_at asc nulls last, v.video_id
    limit $1
  `;
}

export async function listEligibleVideos({
  limit = 50,
  includeApplied = false,
  videoId = null,
} = {}) {
  const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error("POSTGRES_URL or POSTGRES_URL_NON_POOLING is required");
  }

  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("supa");

  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const hasStateTable = await stateTableExists(pool);
    const { rows } = await pool.query(buildListQuery(hasStateTable), [
      limit,
      includeApplied,
      videoId,
      LIVE_OR_APPLIED_STATUSES,
    ]);
    return rows;
  } finally {
    await pool.end();
  }
}

export async function listRecoverableRuns({ limit = 1000 } = {}) {
  const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error("POSTGRES_URL or POSTGRES_URL_NON_POOLING is required");
  }

  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("supa");

  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { rows } = await pool.query(
      `select
         r.run_id,
         r.video_id,
         r.status::text as status,
         r.created_at,
         r.updated_at,
         count(a.artifact_id)::int as artifact_count
       from public.research_pre_research_run r
       join public.research_starter_videos v on v.video_id = r.video_id
       left join public.research_pre_research_artifact a on a.run_id = r.run_id
       where r.status::text = any($2::text[])
         and r.packet_schema_version = $3
         and r.transcript_sha256 = ${CURRENT_TRANSCRIPT_HASH}
         and ${CANONICAL_ELIGIBILITY_PREDICATES}
         and not ${finishedPredicate()}
       group by r.run_id, r.video_id, r.status, r.created_at, r.updated_at
       order by r.created_at asc, r.run_id
       limit $1`,
      [
        limit,
        LIVE_OR_APPLIED_STATUSES.filter((status) => status !== "applied"),
        CURRENT_PACKET_SCHEMA_VERSION,
      ],
    );
    return rows;
  } finally {
    await pool.end();
  }
}
