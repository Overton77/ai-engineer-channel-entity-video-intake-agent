import { createHash, type BinaryLike } from "node:crypto";
import { canonicalizeJson } from "./canonical-json";

export function sha256Hex(input: BinaryLike): string {
  return createHash("sha256").update(input).digest("hex");
}

// SHA-256 of canonicalizeJson(value) encoded as UTF-8 plus a trailing newline.
export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(`${canonicalizeJson(value)}\n`);
}
