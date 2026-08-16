// Tests for: url-normalization — official URL host, hash, slash, and utm handling
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeOfficialUrl } from "../executor/url-normalization";

describe("normalizeOfficialUrl", () => {
  it("lowercases the host, strips the hash, trailing slash, and utm_* params", () => {
    assert.equal(
      normalizeOfficialUrl("https://WWW.Example.COM/docs/?utm_source=news&utm_medium=email&utm_campaign=q1#section"),
      "https://www.example.com/docs",
    );
  });

  it("keeps non-utm query params", () => {
    assert.equal(
      normalizeOfficialUrl("https://Docs.Example.COM/api/?ref=talk&utm_source=yt&version=2#top"),
      "https://docs.example.com/api?ref=talk&version=2",
    );
  });
});
