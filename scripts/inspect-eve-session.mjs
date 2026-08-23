import { loadEnv } from "./load-env.mjs";
import { createAuthenticatedEveClient } from "./eve-client.mjs";

loadEnv();

const sessionId = process.argv[2];
const host = process.argv[3] ?? process.env.EVE_URL;
if (!sessionId || !host) throw new Error("usage: inspect-eve-session <session-id> <host>");
const client = createAuthenticatedEveClient(host);
if (process.argv[4] === "--reset") {
  console.log(JSON.stringify(await client.sessions.attach(sessionId).reset({ reason: "Operator retired stale stage session" })));
} else if (process.argv[4]) {
  console.log(JSON.stringify(await client.sessions.attach(sessionId).cancel({ turnId: process.argv[4] })));
}
const rows = [];
const compact = (value) => {
  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
};
for await (const event of client.sessions.attach(sessionId).stream({ follow: false, startIndex: 0 })) {
  rows.push({
    type: event.type,
    turnId: event.data?.turnId ?? event.data?.turn_id ?? null,
    stepIndex: event.data?.stepIndex ?? null,
    toolName: event.data?.result?.toolName ?? event.data?.toolName ?? null,
    error: compact(event.data?.error ?? event.data?.message ?? event.data?.result?.error ?? null),
  });
}
const meaningful = rows.filter((row) =>
  row.type.includes("failed") ||
  row.type.includes("action") ||
  row.type.includes("tool") ||
  row.type.includes("session") ||
  row.type.includes("turn") ||
  row.error,
);
console.log(JSON.stringify((meaningful.length ? meaningful : rows).slice(-60), null, 2));
