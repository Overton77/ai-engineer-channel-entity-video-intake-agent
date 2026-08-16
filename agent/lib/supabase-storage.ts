import { sha256Hex } from "../../lib/hash";

export class StorageObjectCollisionError extends Error {
  constructor(path: string) {
    super(`STORAGE_CONTENT_COLLISION: object already exists at ${path} with different content`);
    this.name = "StorageObjectCollisionError";
  }
}

function storageConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return { url, key };
}

function objectUrl(bucket: string, path: string): string {
  const { url } = storageConfig();
  const encodedPath = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function authHeaders(extra?: HeadersInit): Headers {
  const { key } = storageConfig();
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("apikey", key);
  return headers;
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText;
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; statusCode?: string };
    return json.message ?? json.error ?? text;
  } catch {
    return text;
  }
}

function asUtf8(body: string | Uint8Array): string {
  return typeof body === "string" ? body : Buffer.from(body).toString("utf8");
}

export async function objectExists(options: { bucket: string; path: string }): Promise<boolean> {
  const response = await fetch(objectUrl(options.bucket, options.path), {
    method: "HEAD",
    headers: authHeaders(),
  });
  if (response.ok) return true;
  if (response.status === 404 || response.status === 400) return false;
  throw new Error(
    `STORAGE_HEAD_FAILED: ${options.bucket}/${options.path} (${response.status}) ${await readErrorBody(response)}`,
  );
}

export type ListedStorageObject = {
  name: string;
  path: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  last_accessed_at: string | null;
  metadata: Record<string, unknown> | null;
  is_folder: boolean;
};

function joinPrefix(prefix: string, name: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/${name}` : name;
}

export async function listObjects(options: {
  bucket: string;
  prefix?: string;
  limit?: number;
  offset?: number;
}): Promise<ListedStorageObject[]> {
  const { url } = storageConfig();
  const prefix = (options.prefix ?? "").replace(/^\/+/, "");
  const response = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(options.bucket)}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      prefix,
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `STORAGE_LIST_FAILED: ${options.bucket}/${prefix} (${response.status}) ${await readErrorBody(response)}`,
    );
  }
  const rows = (await response.json()) as Array<{
    name?: string;
    id?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
    last_accessed_at?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  return rows
    .filter((row) => typeof row.name === "string" && row.name.length > 0)
    .map((row) => {
      const name = row.name as string;
      const isFolder = row.id == null && row.metadata == null;
      return {
        name,
        path: joinPrefix(prefix, name),
        id: row.id ?? null,
        updated_at: row.updated_at ?? null,
        created_at: row.created_at ?? null,
        last_accessed_at: row.last_accessed_at ?? null,
        metadata: row.metadata ?? null,
        is_folder: isFolder,
      };
    });
}

export async function listObjectsRecursive(options: {
  bucket: string;
  prefix?: string;
  pageSize?: number;
}): Promise<ListedStorageObject[]> {
  const pageSize = options.pageSize ?? 100;
  const collected: ListedStorageObject[] = [];
  const prefixes = [(options.prefix ?? "").replace(/^\/+|\/+$/g, "")];
  const seenPrefixes = new Set<string>();

  while (prefixes.length > 0) {
    const prefix = prefixes.shift() as string;
    if (seenPrefixes.has(prefix)) continue;
    seenPrefixes.add(prefix);

    let offset = 0;
    while (true) {
      const page = await listObjects({
        bucket: options.bucket,
        prefix,
        limit: pageSize,
        offset,
      });
      for (const item of page) {
        collected.push(item);
        if (item.is_folder) {
          prefixes.push(item.path);
        }
      }
      if (page.length < pageSize) break;
      offset += page.length;
    }
  }

  return collected;
}

export async function downloadObject(options: { bucket: string; path: string }): Promise<string> {
  const response = await fetch(objectUrl(options.bucket, options.path), {
    method: "GET",
    headers: authHeaders(),
  });
  if (response.status === 404) {
    throw new Error(`STORAGE_OBJECT_NOT_FOUND: ${options.bucket}/${options.path}`);
  }
  if (!response.ok) {
    throw new Error(
      `STORAGE_DOWNLOAD_FAILED: ${options.bucket}/${options.path} (${response.status}) ${await readErrorBody(response)}`,
    );
  }
  return response.text();
}

export async function uploadObject(options: {
  bucket: string;
  path: string;
  body: string | Uint8Array;
  contentType: string;
}): Promise<{ uploaded: boolean; identical: boolean }> {
  const incomingSha = sha256Hex(asUtf8(options.body));
  const exists = await objectExists({ bucket: options.bucket, path: options.path });
  if (exists) {
    const existing = await downloadObject({ bucket: options.bucket, path: options.path });
    if (sha256Hex(existing) !== incomingSha) {
      throw new StorageObjectCollisionError(`${options.bucket}/${options.path}`);
    }
    return { uploaded: false, identical: true };
  }

  const body =
    typeof options.body === "string" ? options.body : Uint8Array.from(options.body);
  const response = await fetch(objectUrl(options.bucket, options.path), {
    method: "POST",
    headers: authHeaders({
      "Content-Type": options.contentType,
      "x-upsert": "false",
    }),
    body,
  });
  if (!response.ok) {
    const existsAfter = await objectExists({ bucket: options.bucket, path: options.path });
    if (existsAfter) {
      const existing = await downloadObject({ bucket: options.bucket, path: options.path });
      if (sha256Hex(existing) === incomingSha) {
        return { uploaded: false, identical: true };
      }
      throw new StorageObjectCollisionError(`${options.bucket}/${options.path}`);
    }
    throw new Error(
      `STORAGE_UPLOAD_FAILED: ${options.bucket}/${options.path} (${response.status}) ${await readErrorBody(response)}`,
    );
  }
  return { uploaded: true, identical: false };
}
