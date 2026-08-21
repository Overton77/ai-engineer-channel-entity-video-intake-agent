import { Client } from "eve/client";
import { loadEnv } from "./load-env.mjs";

loadEnv();
const [runId, sessionId, host = process.env.EVE_URL] = process.argv.slice(2);
if (!runId || !sessionId || !host) {
  throw new Error("usage: recover-research-session <run-id> <session-id> <eve-host>");
}
const token = process.env.VERCEL_OIDC_TOKEN;
const client = new Client({
  host,
  ...(token ? { auth: { vercelOidc: { token } }, redirect: "error" } : {}),
});
try {
  await client.sessions.attach(sessionId).reset({
    reason: "Retire stale research command queue after durable checkpoint recovery",
  });
} catch {
  // The database recovery remains authoritative if the remote session already ended.
}
const { recoverStaleResearchSession } = await import("../controller/pre-research-pipeline.ts");
await recoverStaleResearchSession(runId, sessionId, "retired stale Eve command queue after stage checkpoint");
console.log(JSON.stringify({ recovered: true, run_id: runId, session_id: sessionId }));
