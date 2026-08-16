import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.2",
  reasoning: "medium",
  limits: {
    maxInputTokensPerSession: 2_000_000,
    maxOutputTokensPerSession: 120_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1000,
  },
});
