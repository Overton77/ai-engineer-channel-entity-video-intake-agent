import { loadEnv } from "./load-env.mjs";
import { listEligibleVideos } from "./eligible-videos.mjs";

loadEnv();

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const eveUrl = (arg("--eve-url") ?? process.env.EVE_URL ?? "http://127.0.0.1:2000").replace(/\/$/, "");
const videoIds = [];
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--video-id" && process.argv[i + 1]) {
    videoIds.push(process.argv[i + 1]);
  }
}
const runAll = process.argv.includes("--all");
const runNext = process.argv.includes("--next") || (videoIds.length === 0 && !runAll);
const limit = Number(arg("--limit", "31"));

function promptFor(videoId) {
  if (videoId) {
    return [
      "Run one pre-research video.",
      `Claim video_id ${videoId} with claim_pre_research_video({ video_id: "${videoId}" }).`,
      "Then follow agent/instructions.md exactly: complete only the bounded root-session stage selected by the controller; never fan out subagents.",
      "Do not claim a different video.",
    ].join(" ");
  }
  return [
    "Run one pre-research video.",
    "Call claim_pre_research_video with no video_id to claim the oldest eligible stored transcript.",
    "Then follow agent/instructions.md exactly.",
  ].join(" ");
}

async function waitForTurn(sessionId) {
  const response = await fetch(`${eveUrl}/eve/v1/session/${sessionId}/stream`);
  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastAssistant = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (event.type === "message.completed" && event.data?.message) {
        lastAssistant = event.data.message;
      }
      if (event.type === "turn.failed" || event.type === "session.failed") {
        await reader.cancel();
        return { outcome: "failed", lastAssistant, error: event.data ?? event };
      }
      if (event.type === "turn.completed" || event.type === "session.waiting") {
        await reader.cancel();
        return { outcome: "completed", lastAssistant };
      }
    }
  }

  return { outcome: "unknown", lastAssistant };
}

async function runOne(message) {
  const created = await fetch(`${eveUrl}/eve/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const body = await created.json().catch(() => ({}));
  if (!created.ok) {
    throw new Error(`create session failed: ${created.status} ${JSON.stringify(body)}`);
  }
  const sessionId = body.sessionId;
  if (!sessionId) throw new Error(`no sessionId in ${JSON.stringify(body)}`);
  const result = await waitForTurn(sessionId);
  return { sessionId, ...result };
}

async function health() {
  const response = await fetch(`${eveUrl}/eve/v1/health`);
  if (!response.ok) {
    throw new Error(
      `Eve is not reachable at ${eveUrl}. Start it with: npm exec -- eve dev --no-ui --port 2000`,
    );
  }
}

await health();

let jobs = videoIds;
if (runAll) {
  const rows = await listEligibleVideos({
    limit: Number.isFinite(limit) ? limit : 31,
    includeApplied: false,
  });
  jobs = rows.map((row) => row.video_id);
  if (jobs.length === 0) {
    console.log(JSON.stringify({ claimed: false, reason: "NO_ELIGIBLE_VIDEO" }, null, 2));
    process.exit(0);
  }
} else if (runNext && videoIds.length === 0) {
  jobs = [null];
}

const results = [];
for (const videoId of jobs) {
  console.error(`starting ${videoId ?? "next-oldest"}`);
  const result = await runOne(promptFor(videoId));
  const row = { video_id: videoId, ...result };
  results.push(row);
  console.log(JSON.stringify(row, null, 2));
  if (result.outcome === "failed") {
    console.error("stopping after failure");
    process.exit(1);
  }
}

console.error(`finished ${results.length} session(s)`);
