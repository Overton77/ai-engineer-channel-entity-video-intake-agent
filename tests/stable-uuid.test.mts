import assert from "node:assert/strict";
import { test } from "node:test";
import { stableUuid } from "../lib/stable-uuid";

test("stableUuid is deterministic, scoped, and UUID-shaped", () => {
  const first = stableUuid("run-a:organization:ramp");
  assert.equal(first, stableUuid("run-a:organization:ramp"));
  assert.notEqual(first, stableUuid("run-b:organization:ramp"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
