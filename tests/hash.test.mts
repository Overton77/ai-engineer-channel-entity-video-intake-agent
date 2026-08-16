// Tests for: hash — SHA-256 hex encoding and canonical JSON hashing
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashCanonicalJson, sha256Hex } from "../lib/hash";

describe("sha256Hex", () => {
  it("returns the known SHA-256 hex digest for abc", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("hashCanonicalJson", () => {
  it("returns 64 lowercase hex characters", () => {
    const digest = hashCanonicalJson({ hello: "world" });
    assert.match(digest, /^[0-9a-f]{64}$/);
  });

  it("is equal for objects that differ only by key order", () => {
    assert.equal(hashCanonicalJson({ b: 1, a: 2 }), hashCanonicalJson({ a: 2, b: 1 }));
  });
});
