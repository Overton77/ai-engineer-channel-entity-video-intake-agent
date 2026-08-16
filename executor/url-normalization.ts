export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function normalizeOfficialUrl(raw: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  return normalizeUrl(url.toString());
}
