import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.2",
  reasoning: "medium",
  limits: {
    maxInputTokensPerSession: 20_000_000,
    maxOutputTokensPerSession: 250_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1000,
  },
});
