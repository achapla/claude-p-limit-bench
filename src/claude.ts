// Runs the task once, in one of two modes:
//   p            claude -p "<prompt>" --output-format json   (print mode, as scripts and CI use it)
//   interactive  claude "<prompt>" in a real terminal the script drives, closed when the answer is in the session file
// Both get the same prompt, the same allowed tools and the same folder.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn as spawnTerminal } from "@lydell/node-pty";
import { findSessionFile, isDone, readCalls, type Call } from "./session.ts";
import { ALLOWED_TOOLS, PROMPT } from "./task.ts";

export type Mode = "p" | "interactive";

export interface Run {
  at: string;
  mode: Mode;
  session: string;
  /** The cost claude reports; only print mode reports it. */
  cost: number | null;
  calls: Call[];
  error: string | null;
}

/** A run that has not finished after this time is stopped and saved as failed. */
const RUN_TIMEOUT_MS = 15 * 60_000;

export interface Setup {
  configDir: string;
  fixture: string;
}

/**
 * The environment of a run. When this script runs inside a Claude Code session, claude marks its children,
 * and an interactive child with that mark saves no session file. The mark is removed in both modes.
 */
function env(configDir: string): Record<string, string> {
  const e: Record<string, string> = { ...(process.env as Record<string, string>), CLAUDE_CONFIG_DIR: configDir };
  delete e.CLAUDE_CODE_CHILD_SESSION;
  return e;
}

/** The full path of claude: the terminal library does not search PATH on Windows. */
export function claudePath(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of names) if (existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error("claude is not in PATH; set CLAUDE_BIN");
}

/**
 * Screens that interactive claude can show once before it starts, and the keys that answer them.
 * Print mode never shows them. Each is answered the way that keeps the run like a print-mode run.
 */
const QUESTIONS = [
  // "Do you trust this folder?": "No, exit" is first, "Yes, I trust this folder" second.
  { name: "trust", match: /Itrustthisfolder.*Entertoconfirm/i, keys: ["\x1b[B", "\r"] },
  // "Claude in Chrome extension detected": Esc keeps the browser tools off, as in print mode.
  { name: "chrome", match: /ClaudeinChrome.*Entertoconfirm/i, keys: ["\x1b"] },
];

/** The screen as plain text without spaces: claude draws with cursor moves, so words come without spaces. */
function visibleText(raw: string): string {
  return raw.replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\s+/g, "");
}

const commonArgs = (session: string) => ["--session-id", session, "--allowedTools", ...ALLOWED_TOOLS];

export async function runTask(mode: Mode, setup: Setup): Promise<Run> {
  const session = randomUUID();
  const at = new Date().toISOString();
  const result = mode === "p" ? await runPrint(session, setup) : await runInteractive(session, setup);
  const file = findSessionFile(setup.configDir, session);
  return { at, mode, session, cost: result.cost, calls: file ? readCalls(file) : [], error: result.error ?? (file ? null : "no session file") };
}

async function runPrint(session: string, setup: Setup): Promise<{ cost: number | null; error: string | null }> {
  // The prompt goes last: --allowedTools takes every word after it until the next option.
  const args = ["-p", "--output-format", "json", ...commonArgs(session), "--", PROMPT];
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn(claudePath(), args, { cwd: setup.fixture, env: env(setup.configDir), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.on("error", (err) => resolve({ cost: null, error: err.message }));
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const out = JSON.parse(stdout) as { total_cost_usd?: number; is_error?: boolean; result?: string };
        resolve({ cost: out.total_cost_usd ?? null, error: out.is_error ? (out.result ?? "error") : null });
      } catch {
        resolve({ cost: null, error: `claude -p exited with ${code} and no JSON result` });
      }
    });
  });
}

async function runInteractive(session: string, setup: Setup): Promise<{ cost: null; error: string | null }> {
  const term = spawnTerminal(claudePath(), [...commonArgs(session), "--", PROMPT], {
    cwd: setup.fixture, env: env(setup.configDir), cols: 160, rows: 50,
  });
  let screen = "";
  term.onData((d) => (screen = (screen + d).slice(-20_000)));
  const answered = new Set<string>();

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let error: string | null = "timed out";
  while (Date.now() < deadline) {
    await sleep(3000);
    const text = visibleText(screen);
    for (const q of QUESTIONS) {
      if (answered.has(q.name) || !q.match.test(text.slice(-3000))) continue;
      answered.add(q.name);
      for (const key of q.keys) {
        term.write(key);
        await sleep(700);
      }
    }
    if (/hityour.*limit/i.test(text)) {
      error = "usage limit reached";
      break;
    }
    const file = findSessionFile(setup.configDir, session);
    if (file && isDone(file)) {
      error = null;
      break;
    }
  }
  await sleep(2000);
  term.kill();
  return { cost: null, error };
}
