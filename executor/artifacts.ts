import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { INTENT_BUCKET, PACKET_SCHEMA_VERSION, packetArtifactKinds } from "../contracts/enums";

export const RESEARCH_ARTIFACT_KINDS = [
  "run_manifest",
  "transcript_analysis",
  "taxonomy_classification",
  "web_context",
  "organization_research",
  "source_verification",
  "curriculum_signals",
] as const;

export const SYNTHESIS_ARTIFACT_KINDS = [
  "initial_summary",
  "technology_library_summary",
  "organization_profile",
  "ingestion_intent",
] as const;

export const APPLY_ARTIFACT_KINDS = [...RESEARCH_ARTIFACT_KINDS, ...SYNTHESIS_ARTIFACT_KINDS] as const;

export const ARTIFACT_FILENAMES = {
  run_manifest: "00-run-manifest.json",
  transcript_analysis: "10-transcript-analysis.json",
  taxonomy_classification: "20-taxonomy-classification.json",
  web_context: "30-web-context.json",
  organization_research: "35-organization-research.json",
  source_verification: "40-source-verification.json",
  curriculum_signals: "50-curriculum-signals.json",
  initial_summary: "initial-summary/60-initial-summary.json",
  technology_library_summary: "technology-library-summary/70-technology-library-summary.json",
  organization_profile: "organization-profile/80-organization-profile.json",
  ingestion_intent: "90-ingestion-intent.json",
  execution_receipt: "99-execution-receipt.json",
} as const satisfies Record<(typeof packetArtifactKinds)[number], string>;

export function packetStoragePrefix(videoId: string, runId: string, schemaVersion = PACKET_SCHEMA_VERSION): string {
  const major = schemaVersion.startsWith("1.") ? "v1" : "v2";
  return `pre-research/${major}/${videoId}/${runId}`;
}

export function artifactStoragePath(prefix: string, kind: keyof typeof ARTIFACT_FILENAMES): string {
  return `${prefix.replace(/\/$/, "")}/${ARTIFACT_FILENAMES[kind]}`;
}

export function intentBucket(): string {
  return INTENT_BUCKET;
}

export function hostArtifactPath(storagePath: string): string {
  const relative = storagePath.replace(/^\/+/, "").replace(/^pre-research\//, "");
  return resolve(process.cwd(), "outputs", "pre-research", relative);
}

export async function writeHostArtifact(
  storagePath: string,
  content: string | Buffer,
): Promise<string> {
  const outputPath = hostArtifactPath(storagePath);
  // Vercel Functions expose the application bundle under read-only /var/task.
  // Supabase Storage is authoritative in production; local materialization is
  // only a workstation convenience.
  if (process.env.VERCEL) return outputPath;
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, outputPath);
  return outputPath;
}
