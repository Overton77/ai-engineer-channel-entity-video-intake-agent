import { defineDynamic, webSearch } from "eve/tools";
import type { ModelMessage } from "ai";
import { researchStageFromMessages } from "../lib/turn-capabilities";

function webSearchCallsInCurrentTurn(messages: readonly ModelMessage[]): number {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      start = index;
      break;
    }
  }
  let count = 0;
  for (const message of messages.slice(start)) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "tool-call" &&
        "toolName" in part &&
        part.toolName === "web_search"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      const stage = researchStageFromMessages(ctx.messages);
      if (!stage || stage === "transcript_taxonomy" || stage === "curriculum") return null;
      const cap = stage === "source_verification" ? 2 : 3;
      return webSearchCallsInCurrentTurn(ctx.messages) >= cap
        ? null
        : webSearch({ provider: "exa" });
    },
  },
});
