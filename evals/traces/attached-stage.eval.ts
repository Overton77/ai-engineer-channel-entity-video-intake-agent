import { defineEval } from "eve/evals";
import { numericScore } from "../lib/eve-assertions";
import { evaluateTrace } from "../lib/trace-evaluation";

const sessionIds = (process.env.PRE_RESEARCH_EVAL_SESSION_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export default defineEval({
  description: "Attach a real Eve stage session and grade its complete event trajectory.",
  tags: ["trace", "attached", "production"],
  timeoutMs: 180_000,
  async test(t) {
    if (sessionIds.length === 0) {
      t.skip("Set PRE_RESEARCH_EVAL_SESSION_IDS to one or more Eve session IDs");
    }
    for (const sessionId of sessionIds) {
      const session = await t.target.attachSession(sessionId!);
      const result = evaluateTrace(`session:${sessionId}`, session.events);
      for (const item of result.findings) {
        t.check(
          item.score,
          numericScore(
            `${sessionId}:${item.name}`,
            item.severity === "score" ? "soft" : "gate",
            item.threshold,
            item.message,
          ),
        ).label(`${sessionId}:${item.name}`);
      }
      t.log(JSON.stringify({ session_id: sessionId, score: result.score, metrics: result.metrics }));
    }
  },
});
