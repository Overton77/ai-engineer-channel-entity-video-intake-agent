import { Client } from "eve/client";

const parentId = process.argv[2];
const hours = Number(process.argv[3] ?? "3");
if (!parentId) {
  console.error("Usage: approve-session-limits.mjs <parentSessionId> [hours]");
  process.exit(2);
}

const client = new Client({ host: process.env.EVE_URL ?? "http://127.0.0.1:2000" });
const session = client.sessions.attach(parentId);
const answered = new Set();
const deadline = Date.now() + Math.max(hours, 0.25) * 60 * 60 * 1000;

while (Date.now() < deadline) {
  const snap = await session.snapshot();
  const pending = [];
  for (const event of snap.events ?? []) {
    if (event.type !== "input.requested") continue;
    for (const request of event.data?.requests ?? []) {
      if (request.kind !== "session-limit") continue;
      if (!request.requestId || answered.has(request.requestId)) continue;
      const optionId =
        request.options?.find((option) => option.id === "continue")?.id ??
        request.options?.find((option) => option.id === "approve")?.id ??
        "continue";
      pending.push({ requestId: request.requestId, optionId });
    }
  }
  if (pending.length > 0) {
    for (const item of pending) answered.add(item.requestId);
    console.log(new Date().toISOString(), "approving", pending.length, pending.map((p) => p.requestId));
    try {
      const resumed = await session.respond(pending);
      await resumed.result();
    } catch (error) {
      console.error("respond failed", error instanceof Error ? error.message : error);
      for (const item of pending) answered.delete(item.requestId);
    }
  } else {
    console.log(new Date().toISOString(), "no pending session-limit");
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
