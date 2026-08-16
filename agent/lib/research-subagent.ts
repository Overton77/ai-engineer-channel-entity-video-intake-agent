import { defineAgent, defineDynamic } from "eve";
import { resolveRunPhase } from "./phase";

type ResearchSubagentConfig = {
  description: string;
  reasoning?: "low" | "medium" | "high";
};

export function defineResearchSubagent(config: ResearchSubagentConfig) {
  return defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        const resolved = await resolveRunPhase(ctx);
        if (resolved?.phase === "synthesis") return null;
        return defineAgent({
          description: config.description,
          model: "zai/glm-5.2",
          reasoning: config.reasoning ?? "medium",
        });
      },
    },
  });
}
