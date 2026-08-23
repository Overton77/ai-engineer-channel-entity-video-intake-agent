import { defineDynamic, defineTool } from "eve/tools";
import { webFetch } from "eve/tools/defaults";
import { stageAllowsWebFetch } from "../lib/stage-network";
import { researchStageFromMessages } from "../lib/turn-capabilities";

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      if (!stageAllowsWebFetch(researchStageFromMessages(ctx.messages))) return null;
      return {
        web_fetch: defineTool({
          ...webFetch,
          async execute(input, toolCtx) {
            return await webFetch.execute(input, toolCtx);
          },
        }),
      };
    },
  },
});
