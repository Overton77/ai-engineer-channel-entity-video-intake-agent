// Tests for: canonical-json — key order, omitted keys, array holes, Date, and rejected values
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeJson } from "../lib/canonical-json";
import { hashCanonicalJson } from "../lib/hash";

describe("canonicalizeJson", () => {
  it("does not change output when object keys are reordered", () => {
    const left = canonicalizeJson({ b: 1, a: { z: true, m: 2 } });
    const right = canonicalizeJson({ a: { m: 2, z: true }, b: 1 });
    assert.equal(left, right);
    assert.equal(left, '{"a":{"m":2,"z":true},"b":1}');
  });

  it("omits undefined object keys", () => {
    assert.equal(canonicalizeJson({ keep: 1, skip: undefined, also: "ok" }), '{"also":"ok","keep":1}');
  });

  it("turns undefined array holes into null", () => {
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    assert.equal(canonicalizeJson(sparse), "[1,null,3]");
    assert.equal(canonicalizeJson([1, undefined, 3]), "[1,null,3]");
  });

  it("serializes Date values as ISO strings", () => {
    const at = new Date("2026-08-16T12:34:56.000Z");
    assert.equal(canonicalizeJson(at), '"2026-08-16T12:34:56.000Z"');
    assert.equal(canonicalizeJson({ at }), '{"at":"2026-08-16T12:34:56.000Z"}');
  });

  it("rejects NaN", () => {
    assert.throws(() => canonicalizeJson(Number.NaN), TypeError);
    assert.throws(() => canonicalizeJson({ n: Number.NaN }), TypeError);
  });

  it("rejects bigint", () => {
    assert.throws(() => canonicalizeJson(1n), TypeError);
    assert.throws(() => canonicalizeJson({ n: 1n }), TypeError);
  });
});

describe("hashCanonicalJson", () => {
  it("is stable when object keys are reordered", () => {
    assert.equal(hashCanonicalJson({ b: 1, a: 2 }), hashCanonicalJson({ a: 2, b: 1 }));
  });
});
