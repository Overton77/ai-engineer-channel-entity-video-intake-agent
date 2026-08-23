import { getVercelOidcToken } from "@vercel/oidc";
import { Client } from "eve/client";

function isLocalHost(host) {
  try {
    const hostname = new URL(host).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return true;
  }
}

/**
 * Creates the same local-or-production Eve client used by the controller.
 * The token callback refreshes expired `eve link` credentials through the
 * authenticated Vercel CLI instead of relying on a stale .env.local value.
 */
export function createAuthenticatedEveClient(host) {
  const resolvedHost = host.replace(/\/$/, "");
  return new Client({
    host: resolvedHost,
    ...(isLocalHost(resolvedHost)
      ? {}
      : {
          auth: {
            vercelOidc: {
              token: () => getVercelOidcToken({ expirationBufferMs: 5 * 60 * 1000 }),
            },
          },
          redirect: "error",
        }),
  });
}
