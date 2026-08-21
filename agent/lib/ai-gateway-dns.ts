import { Resolver, lookup as systemLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, setGlobalDispatcher } from "undici";

const AI_GATEWAY_HOST = "ai-gateway.vercel.sh";
let installed = false;

/**
 * Opt-in, process-local DNS repair for networks whose router rewrites the
 * AI Gateway address. TLS verification remains enabled and validates the
 * original hostname; only this one hostname bypasses the OS resolver.
 */
export function installAiGatewayDnsOverrideFromEnv(): boolean {
  if (installed) return true;
  const raw = process.env.PRE_RESEARCH_AI_GATEWAY_DNS_SERVERS?.trim();
  if (!raw) return false;

  const servers = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (servers.length === 0) {
    throw new Error("PRE_RESEARCH_AI_GATEWAY_DNS_SERVERS must contain at least one DNS server");
  }
  const resolver = new Resolver();
  resolver.setServers(servers);

  const lookup: LookupFunction = (hostname, options, callback) => {
    if (hostname.toLowerCase() !== AI_GATEWAY_HOST) {
      systemLookup(hostname, options, callback);
      return;
    }
    resolver.resolve4(hostname, { ttl: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      const results = addresses.map(({ address }) => ({ address, family: 4 as const }));
      if (typeof options === "object" && options !== null && "all" in options && options.all) {
        callback(null, results);
        return;
      }
      callback(null, results[0]?.address ?? "", 4);
    });
  };

  setGlobalDispatcher(new Agent({ connect: { lookup } }));
  installed = true;
  return true;
}
