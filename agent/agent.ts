import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.2",
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.35,
  },
  limits: {
    maxInputTokensPerSession: 300_000,
    maxOutputTokensPerSession: 32_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1000,
  },
});
