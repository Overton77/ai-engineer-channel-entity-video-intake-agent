import { INTENT_BUCKET } from "../contracts/enums";
import { sha256Hex } from "../lib/hash";

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error("SUPABASE_URL is not set");
  }
  if (!serviceRole) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return { url, serviceRole };
}

function objectUrl(bucket: string, path: string): string {
  const { url } = supabaseConfig();
  const encodedPath = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function authHeaders(extra?: HeadersInit): Headers {
  const { serviceRole } = supabaseConfig();
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${serviceRole}`);
  headers.set("apikey", serviceRole);
  return headers;
}

export async function downloadStorageObject(
  bucket: string,
  path: string,
): Promise<{ bytes: Buffer; sha256: string }> {
  const response = await fetch(objectUrl(bucket, path), {
    method: "GET",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `Storage download failed for ${bucket}/${path}: ${response.status} ${await response.text()}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, sha256: sha256Hex(bytes) };
}

export async function uploadStorageObject(input: {
  bucket?: string;
  path: string;
  body: string | Buffer;
  contentType?: string;
  upsert?: boolean;
}): Promise<{ sha256: string; byteCount: number }> {
  const bucket = input.bucket ?? INTENT_BUCKET;
  const body = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : input.body;
  const response = await fetch(objectUrl(bucket, pathForUpload(input.path)), {
    method: "POST",
    headers: authHeaders({
      "Content-Type": input.contentType ?? "application/json",
      "x-upsert": input.upsert === false ? "false" : "true",
    }),
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(
      `Storage upload failed for ${bucket}/${input.path}: ${response.status} ${await response.text()}`,
    );
  }
  return { sha256: sha256Hex(body), byteCount: body.byteLength };
}

function pathForUpload(path: string): string {
  return path.replace(/^\/+/, "");
}

export async function downloadJsonObject(bucket: string, path: string): Promise<{
  json: unknown;
  bytes: Buffer;
  sha256: string;
}> {
  const downloaded = await downloadStorageObject(bucket, path);
  return {
    ...downloaded,
    json: JSON.parse(downloaded.bytes.toString("utf8")) as unknown,
  };
}
