function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === undefined) {
    throw new TypeError("canonical JSON does not allow undefined");
  }
  if (value === null) {
    return null;
  }
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return value;
  }
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON does not allow NaN or Infinity");
    }
    return value;
  }
  if (valueType === "bigint") {
    throw new TypeError("canonical JSON does not allow bigint");
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeValue(item)));
  }
  if (!isPlainObject(value)) {
    throw new TypeError("canonical JSON only accepts JSON-plain values");
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined) {
      continue;
    }
    sorted[key] = canonicalizeValue(item);
  }
  return sorted;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}
