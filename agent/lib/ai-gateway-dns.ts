import { Resolver, lookup as systemLookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
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
  const rawAddresses = process.env.PRE_RESEARCH_AI_GATEWAY_IPS?.trim();
  const rawServers = process.env.PRE_RESEARCH_AI_GATEWAY_DNS_SERVERS?.trim();
  if (!rawAddresses && !rawServers) return false;

  const addresses = rawAddresses
    ? rawAddresses.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  for (const address of addresses) {
    if (isIP(address) !== 4) {
      throw new Error(`PRE_RESEARCH_AI_GATEWAY_IPS contains a non-IPv4 address: ${address}`);
    }
  }

  const servers = rawServers
    ? rawServers.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  if (rawAddresses && addresses.length === 0) {
    throw new Error("PRE_RESEARCH_AI_GATEWAY_IPS must contain at least one IPv4 address");
  }
  if (!rawAddresses && servers.length === 0) {
    throw new Error("PRE_RESEARCH_AI_GATEWAY_DNS_SERVERS must contain at least one DNS server");
  }
  const resolver = servers.length > 0 ? new Resolver() : null;
  resolver?.setServers(servers);
  let nextAddress = 0;

  const lookup: LookupFunction = (hostname, options, callback) => {
    if (hostname.toLowerCase() !== AI_GATEWAY_HOST) {
      systemLookup(hostname, options, callback);
      return;
    }
    if (addresses.length > 0) {
      const results = addresses.map((address) => ({ address, family: 4 as const }));
      if (typeof options === "object" && options !== null && "all" in options && options.all) {
        callback(null, results);
        return;
      }
      const selected = addresses[nextAddress % addresses.length]!;
      nextAddress += 1;
      callback(null, selected, 4);
      return;
    }
    resolver!.resolve4(hostname, { ttl: true }, (error, resolvedAddresses) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      const results = resolvedAddresses.map(({ address }) => ({ address, family: 4 as const }));
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
