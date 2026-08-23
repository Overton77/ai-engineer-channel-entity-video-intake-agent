import { loadEnv } from "../../../../scripts/load-env.mjs";
import { createAuthenticatedEveClient } from "../../../../scripts/eve-client.mjs";

loadEnv();

const host = process.argv[2] ?? "https://research-starter-pre-research-agent.vercel.app";
const client = createAuthenticatedEveClient(host);
const [health, info] = await Promise.all([client.health(), client.info()]);

console.log(JSON.stringify({
  host,
  health,
  agent: {
    name: info.agent?.name ?? null,
    model: info.agent?.model ?? null,
  },
  schedules: info.agent?.schedules ?? info.schedules ?? [],
}, null, 2));
