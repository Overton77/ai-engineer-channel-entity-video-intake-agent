import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ARTIFACT_FILENAMES } from "../../executor/artifacts";
import { canonicalizeJson } from "../../lib/canonical-json";
import { hashCanonicalJson, sha256Hex } from "../../lib/hash";

export type ArtifactSandbox = {
  writeTextFile(input: { path: string; content: string }): PromiseLike<void>;
};

export const RESEARCH_ARTIFACT_FILES = {
  run_manifest: ARTIFACT_FILENAMES.run_manifest,
  transcript_analysis: ARTIFACT_FILENAMES.transcript_analysis,
  taxonomy_classification: ARTIFACT_FILENAMES.taxonomy_classification,
  web_context: ARTIFACT_FILENAMES.web_context,
  organization_research: ARTIFACT_FILENAMES.organization_research,
  source_verification: ARTIFACT_FILENAMES.source_verification,
  curriculum_signals: ARTIFACT_FILENAMES.curriculum_signals,
} as const;

export const SYNTHESIS_ARTIFACT_FILES = {
  initial_summary: ARTIFACT_FILENAMES.initial_summary,
  technology_library_summary: ARTIFACT_FILENAMES.technology_library_summary,
  organization_profile: ARTIFACT_FILENAMES.organization_profile,
  ingestion_intent: ARTIFACT_FILENAMES.ingestion_intent,
} as const;

export function packetRelativePrefix(videoId: string, runId: string): string {
  return `v2/${videoId}/${runId}`;
}

export function packetStoragePrefix(videoId: string, runId: string): string {
  return `pre-research/${packetRelativePrefix(videoId, runId)}`;
}

export function artifactRelativePath(
  videoId: string,
  runId: string,
  fileName: string,
): string {
  return `${packetRelativePrefix(videoId, runId)}/${fileName}`;
}

export function serializeArtifact(value: unknown): {
  content: string;
  sha256: string;
  byteCount: number;
} {
  const content = `${canonicalizeJson(value)}\n`;
  return {
    content,
    sha256: hashCanonicalJson(value),
    byteCount: Buffer.byteLength(content, "utf8"),
  };
}

function containsRawTranscript(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsRawTranscript);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.transcript_text === "string") {
    return true;
  }
  return Object.values(record).some(containsRawTranscript);
}

export async function writeLocalJson(relativePath: string, value: unknown): Promise<string> {
  const outputPath = resolve(process.cwd(), "outputs", "pre-research", relativePath);
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return outputPath;
}

export async function persistArtifact(options: {
  relativePath: string;
  value: unknown;
  sandbox?: ArtifactSandbox | null;
}): Promise<{
  localPath: string;
  sandboxPath: string;
  sandboxSaved: boolean;
  sandboxError: string | null;
  content: string;
  sha256: string;
  byteCount: number;
}> {
  if (containsRawTranscript(options.value)) {
    throw new Error("RAW_TRANSCRIPT_FORBIDDEN: artifacts must not include transcript_text");
  }

  const serialized = serializeArtifact(options.value);
  if (serialized.sha256 !== sha256Hex(serialized.content)) {
    throw new Error("CANONICAL_HASH_MISMATCH: serializeArtifact hash drifted from sha256Hex");
  }

  const outputPath = resolve(process.cwd(), "outputs", "pre-research", options.relativePath);
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, serialized.content, "utf8");
  await rename(temporaryPath, outputPath);

  const sandboxPath = `/workspace/pre-research/${options.relativePath}`;
  let sandboxSaved = false;
  let sandboxError: string | null = null;
  if (options.sandbox) {
    try {
      await options.sandbox.writeTextFile({ path: sandboxPath, content: serialized.content });
      sandboxSaved = true;
    } catch (error) {
      sandboxError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    localPath: outputPath,
    sandboxPath,
    sandboxSaved,
    sandboxError,
    content: serialized.content,
    sha256: serialized.sha256,
    byteCount: serialized.byteCount,
  };
}
