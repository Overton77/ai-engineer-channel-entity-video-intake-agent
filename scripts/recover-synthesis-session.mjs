import { loadEnv } from "./load-env.mjs";
import { createAuthenticatedEveClient } from "./eve-client.mjs";

loadEnv();
const [runId, sessionId, host = process.env.EVE_URL] = process.argv.slice(2);
if (!runId || !sessionId || !host) {
  throw new Error("usage: recover-synthesis-session <run-id> <session-id> <eve-host>");
}
const client = createAuthenticatedEveClient(host);
try {
  await client.sessions.attach(sessionId).reset({
    reason: "Retire stale synthesis command queue after durable checkpoint recovery",
  });
} catch {
  // The database recovery remains authoritative if the remote session already ended.
}
const { recoverStaleSynthesisSession } = await import("../controller/pre-research-pipeline.ts");
await recoverStaleSynthesisSession(runId, sessionId, "retired stale Eve command queue after stage checkpoint");
console.log(JSON.stringify({ recovered: true, run_id: runId, session_id: sessionId }));
