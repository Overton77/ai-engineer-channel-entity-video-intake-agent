import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";
import { persistArtifact } from "../agent/lib/artifact-storage";
import { hostArtifactPath, writeHostArtifact } from "../executor/artifacts";

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

test("writeHostArtifact skips the read-only host output on Vercel", async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  const storagePath = `pre-research/v2/test-only/${Date.now()}-no-host-write.json`;
  try {
    const outputPath = await writeHostArtifact(storagePath, "{}\n");
    assert.equal(outputPath, hostArtifactPath(storagePath));
    await assert.rejects(access(outputPath));
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
