import { webSearch } from "eve/tools";

// Eve's provider-managed web search is a special static tool definition. It
// cannot be returned from defineDynamic/defineTool in Eve 0.38.x. Stage prompts
// enforce the narrower per-stage query budgets.
export default webSearch({ provider: "exa" });
