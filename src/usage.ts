// Reads the 5-hour and weekly limit % of the account, from the endpoint that Claude Code's /usage reads.
// The endpoint is not documented, so it may change. The login token is read only to call it; it is never printed or saved.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Usage {
  session: number | null;
  week: number | null;
  resets: string | null;
}

/** The OAuth token of the profile: CLAUDE_OAUTH_TOKEN, else .credentials.json (Windows, Linux), else the macOS Keychain. */
function token(configDir: string): string {
  if (process.env.CLAUDE_OAUTH_TOKEN) return process.env.CLAUDE_OAUTH_TOKEN;
  const file = path.join(configDir, ".credentials.json");
  let raw: string | null = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (!raw && process.platform === "darwin") {
    try {
      raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { encoding: "utf8" });
    } catch {
      raw = null;
    }
  }
  const value = raw ? (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken : undefined;
  if (!value) throw new Error(`no Claude login found for ${configDir}; log in with claude, or set CLAUDE_OAUTH_TOKEN`);
  return value;
}

export async function readUsage(configDir: string): Promise<Usage> {
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${token(configDir)}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!res.ok) throw new Error(`usage endpoint: ${res.status} (start claude once to renew the login)`);
  const d = (await res.json()) as { five_hour?: { utilization?: number; resets_at?: string }; seven_day?: { utilization?: number } };
  return { session: d.five_hour?.utilization ?? null, week: d.seven_day?.utilization ?? null, resets: d.five_hour?.resets_at ?? null };
}

/** The reset time moves by some milliseconds between reads; a new window resets at least an hour later. */
export function sameWindow(a: Usage, b: Usage): boolean {
  return a.resets !== null && b.resets !== null && Math.abs(Date.parse(a.resets) - Date.parse(b.resets)) < 60_000;
}

/** Anthropic's peak hours: weekdays 5-11am US Pacific time. */
export function usPeak(iso: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", hour12: false })
    .formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  const day = parts.find((p) => p.type === "weekday")?.value;
  return day !== "Sat" && day !== "Sun" && hour >= 5 && hour < 11;
}
