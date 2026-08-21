import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv() {
  // Match the usual local precedence without adding a dotenv dependency.
  // `.env.local` is where `eve link` writes its short-lived Vercel OIDC token.
  for (const [fileName, override] of [
    [".env", false],
    [".env.local", true],
  ]) {
    try {
      const text = readFileSync(resolve(process.cwd(), fileName), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (override || process.env[key] == null) process.env[key] = value;
      }
    } catch {
      // Env files are optional when the shell or deployment already has vars.
    }
  }
}
