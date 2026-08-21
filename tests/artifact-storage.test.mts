import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";
import { persistArtifact } from "../agent/lib/artifact-storage";

test("persistArtifact skips the read-only host output on Vercel", async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const result = await persistArtifact({
      relativePath: "test-only/vercel-no-host-write.json",
      value: { safe: true },
    });
    assert.equal(result.localSaved, false);
    await assert.rejects(access(result.localPath));
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
