import { INTENT_BUCKET, PACKET_SCHEMA_VERSION, packetArtifactKindSchema } from "../../contracts/enums";
import {
  curriculumSignalsSchema,
  organizationResearchSchema,
  runManifestSchema,
  sourceVerificationSchema,
  taxonomyClassificationSchema,
  transcriptAnalysisSchema,
  webContextSchema,
  type ResearchPhasePacket,
} from "../../contracts/pre-research-packet";
import { hashCanonicalJson, sha256Hex } from "../../lib/hash";
import {
  persistArtifact,
  type ArtifactSandbox,
} from "./artifact-storage";
import { query } from "./postgres";
import { downloadObject, uploadObject } from "./supabase-storage";

export const RESEARCH_PHASE_KINDS = [
  "run_manifest",
  "transcript_analysis",
  "taxonomy_classification",
  "web_context",
  "organization_research",
  "source_verification",
  "curriculum_signals",
] as const;

export const SYNTHESIS_PHASE_KINDS = [
  "initial_summary",
  "technology_library_summary",
  "organization_profile",
  "ingestion_intent",
] as const;

export type ResearchPhaseKind = (typeof RESEARCH_PHASE_KINDS)[number];
export type SynthesisPhaseKind = (typeof SYNTHESIS_PHASE_KINDS)[number];

export type RegisteredArtifact = {
  artifact_id: string;
  run_id: string;
  intent_id: string | null;
  artifact_kind: string;
  schema_version: string;
  storage_bucket: string;
  storage_path: string;
  content_sha256: string;
  byte_count: string | number;
};

const researchParsers = {
  run_manifest: runManifestSchema,
  transcript_analysis: transcriptAnalysisSchema,
  taxonomy_classification: taxonomyClassificationSchema,
  web_context: webContextSchema,
  organization_research: organizationResearchSchema,
  source_verification: sourceVerificationSchema,
  curriculum_signals: curriculumSignalsSchema,
} as const;

export async function listRegisteredArtifacts(runId: string): Promise<RegisteredArtifact[]> {
  return query<RegisteredArtifact>(
    `select
       artifact_id, run_id, intent_id, artifact_kind, schema_version,
       storage_bucket, storage_path, content_sha256, byte_count
     from public.research_pre_research_artifact
     where run_id = $1
     order by artifact_kind`,
    [runId],
  );
}

export async function registerArtifact(input: {
  runId: string;
  intentId?: string | null;
  artifactKind: string;
  schemaVersion: string;
  storageBucket: string;
  storagePath: string;
  contentSha256: string;
  byteCount: number;
}): Promise<RegisteredArtifact> {
  packetArtifactKindSchema.parse(input.artifactKind);

  const existing = await query<RegisteredArtifact>(
    `select
       artifact_id, run_id, intent_id, artifact_kind, schema_version,
       storage_bucket, storage_path, content_sha256, byte_count
     from public.research_pre_research_artifact
     where run_id = $1 and artifact_kind = $2`,
    [input.runId, input.artifactKind],
  );
  const row = existing[0];
  if (row) {
    if (row.content_sha256 !== input.contentSha256) {
      throw new Error(
        `ARTIFACT_CONTENT_COLLISION: ${input.artifactKind} already registered with a different content_sha256`,
      );
    }
    if (row.storage_bucket !== input.storageBucket || row.storage_path !== input.storagePath) {
      throw new Error(
        `ARTIFACT_PATH_COLLISION: ${input.artifactKind} already registered at a different storage path`,
      );
    }
    return row;
  }

  const inserted = await query<RegisteredArtifact>(
    `insert into public.research_pre_research_artifact (
       run_id, intent_id, artifact_kind, schema_version,
       storage_bucket, storage_path, content_sha256, byte_count
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning
       artifact_id, run_id, intent_id, artifact_kind, schema_version,
       storage_bucket, storage_path, content_sha256, byte_count`,
    [
      input.runId,
      input.intentId ?? null,
      input.artifactKind,
      input.schemaVersion,
      input.storageBucket,
      input.storagePath,
      input.contentSha256,
      input.byteCount,
    ],
  );
  const created = inserted[0];
  if (!created) {
    throw new Error(`ARTIFACT_REGISTER_FAILED: ${input.artifactKind}`);
  }
  return created;
}

export async function commitArtifact(options: {
  runId: string;
  intentId?: string | null;
  artifactKind: string;
  schemaVersion?: string;
  relativePath: string;
  value: unknown;
  sandbox?: ArtifactSandbox | null;
}): Promise<{
  kind: string;
  storage_bucket: string;
  storage_path: string;
  content_sha256: string;
  byte_count: number;
  local_path: string;
  sandbox_path: string;
  sandbox_saved: boolean;
  sandbox_error: string | null;
}> {
  const persisted = await persistArtifact({
    relativePath: options.relativePath,
    value: options.value,
    sandbox: options.sandbox,
  });
  const storagePath = `pre-research/${options.relativePath}`;
  await uploadObject({
    bucket: INTENT_BUCKET,
    path: storagePath,
    body: persisted.content,
    contentType: "application/json",
  });
  const registered = await registerArtifact({
    runId: options.runId,
    intentId: options.intentId,
    artifactKind: options.artifactKind,
    schemaVersion: options.schemaVersion ?? PACKET_SCHEMA_VERSION,
    storageBucket: INTENT_BUCKET,
    storagePath,
    contentSha256: persisted.sha256,
    byteCount: persisted.byteCount,
  });
  return {
    kind: registered.artifact_kind,
    storage_bucket: registered.storage_bucket,
    storage_path: registered.storage_path,
    content_sha256: registered.content_sha256,
    byte_count: persisted.byteCount,
    local_path: persisted.localPath,
    sandbox_path: persisted.sandboxPath,
    sandbox_saved: persisted.sandboxSaved,
    sandbox_error: persisted.sandboxError,
  };
}

export async function downloadVerifiedArtifact(registered: RegisteredArtifact): Promise<unknown> {
  const body = await downloadObject({
    bucket: registered.storage_bucket,
    path: registered.storage_path,
  });
  if (sha256Hex(body) !== registered.content_sha256) {
    throw new Error(
      `ARTIFACT_HASH_MISMATCH: ${registered.artifact_kind} at ${registered.storage_path}`,
    );
  }
  return JSON.parse(body);
}

export async function loadRegisteredResearchPacket(runId: string): Promise<{
  packet: ResearchPhasePacket;
  artifacts: RegisteredArtifact[];
}> {
  const registered = await listRegisteredArtifacts(runId);
  const byKind = new Map(registered.map((row) => [row.artifact_kind, row]));
  const missing = RESEARCH_PHASE_KINDS.filter((kind) => !byKind.has(kind));
  if (missing.length > 0) {
    throw new Error(`RESEARCH_CHECKPOINT_INCOMPLETE: missing ${missing.join(", ")}`);
  }

  const parsed: Partial<ResearchPhasePacket> = {};
  const used: RegisteredArtifact[] = [];
  for (const kind of RESEARCH_PHASE_KINDS) {
    const row = byKind.get(kind);
    if (!row) {
      throw new Error(`RESEARCH_CHECKPOINT_INCOMPLETE: missing ${kind}`);
    }
    const value = await downloadVerifiedArtifact(row);
    parsed[kind] = researchParsers[kind].parse(value) as never;
    used.push(row);
  }

  return { packet: parsed as ResearchPhasePacket, artifacts: used };
}

export function packetManifestHash(
  prefix: string,
  artifacts: readonly { artifact_kind: string; content_sha256: string; storage_path: string }[],
): string {
  return hashCanonicalJson({
    packet_storage_prefix: prefix,
    artifacts: [...artifacts]
      .map((artifact) => ({
        artifact_kind: artifact.artifact_kind,
        content_sha256: artifact.content_sha256,
        storage_path: artifact.storage_path,
      }))
      .sort((a, b) => a.artifact_kind.localeCompare(b.artifact_kind)),
  });
}
