// Does claude -p use more of the subscription limit than an interactive session, for the same work?
//   pnpm bench usage                        the 5-hour and weekly limit % now
//   pnpm bench batch <p|interactive> [n]    n runs of one mode (default 7), with the limit % before and after
//   pnpm bench run [--runs 7] [--rounds 2]  batches of both modes in turns: p, interactive, then interactive, p, ...
//   pnpm bench report [--markdown]          the runs, the averages per mode, and the batches with tokens and $ per 1%
// Option for all: --config-dir <folder> (default: CLAUDE_CONFIG_DIR, else ~/.claude).
// Nothing else may use the account during a batch (no other claude session, not on another computer either).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { claudePath, runTask, type Mode, type Run, type Setup } from "./claude.ts";
import { pricedTokens } from "./session.ts";
import { readUsage, sameWindow, usPeak, type Usage } from "./usage.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "results");
const RUNS_FILE = path.join(RESULTS, "runs.jsonl");
const BATCHES_FILE = path.join(RESULTS, "batches.jsonl");
/** How long to wait after a batch before reading the % again, so the last run is counted. */
const SETTLE_MS = 60_000;

interface Batch {
  start: string;
  end: string;
  mode: Mode;
  sessions: string[];
  before: Usage;
  after: Usage;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

function setup(): Setup {
  const configDir = option("config-dir") ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return { configDir: path.resolve(configDir), fixture: path.join(ROOT, "fixture") };
}

function readJsonl<T>(file: string): T[] {
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];
}

function append(file: string, value: unknown): void {
  mkdirSync(RESULTS, { recursive: true });
  appendFileSync(file, `${JSON.stringify(value)}\n`);
}

/** The number of running claude processes. Another session on the same account makes the % of a batch wrong. */
function otherClaudes(): number {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" });
      return out.split("\n").filter((l) => l.toLowerCase().includes("claude.exe")).length;
    }
    return execFileSync("pgrep", ["-x", "claude"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** The setup of this computer, for people who share their results. The script cannot know the plan. */
function setupInfo(runs: Run[]): Record<string, string> {
  let version = "?";
  try {
    version = execFileSync(claudePath(), ["--version"], { encoding: "utf8" }).trim();
  } catch {}
  return {
    "Claude Code": version,
    models: [...new Set(runs.flatMap((r) => r.calls.map((c) => c.model)))].join(", "),
    system: `${os.type()} ${os.release()} (${os.arch()})`,
    "Node.js": process.version,
    "time zone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    plan: "(please add: Pro, Max 5x, Max 20x, Team, ...)",
  };
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;

async function batch(mode: Mode, runs: number, s: Setup): Promise<boolean> {
  const others = otherClaudes();
  if (others > 0) console.log(`warning: ${others} other claude process(es) running. If they use this account, the % of this batch is wrong.`);
  const before = await readUsage(s.configDir);
  console.log(`${mode}: before ${before.session}% (5-hour), ${before.week}% (weekly)`);
  const start = new Date().toISOString();
  const sessions: string[] = [];
  for (let i = 0; i < runs; i++) {
    const run = await runTask(mode, s);
    append(RUNS_FILE, run);
    sessions.push(run.session);
    const cost = run.cost === null ? "" : `, $${run.cost.toFixed(3)}`;
    console.log(`  run ${i + 1}/${runs}: ${run.calls.length} calls, ${k(pricedTokens(run.calls))} priced tokens${cost}${run.error ? `, error: ${run.error}` : ""}`);
    if (run.error === "usage limit reached") return false;
  }
  const end = new Date().toISOString();
  await sleep(SETTLE_MS);
  const after = await readUsage(s.configDir);
  console.log(`${mode}: after ${after.session}% (5-hour), ${after.week}% (weekly)`);
  append(BATCHES_FILE, { start, end, mode, sessions, before, after } satisfies Batch);
  if (!sameWindow(before, after)) {
    console.log("the 5-hour window reset during the batch, so its % cannot be used");
    return false;
  }
  return true;
}

function report(markdown: boolean): void {
  const runs = readJsonl<Run>(RUNS_FILE).filter((r) => r.calls.length > 0);
  const batches = readJsonl<Batch>(BATCHES_FILE);
  if (runs.length === 0) throw new Error("no runs yet");
  // The price of one priced token, from the print-mode runs that report their cost. Interactive costs are estimated with it.
  const known = runs.filter((r) => r.cost !== null);
  const rate = known.length ? known.reduce((s, r) => s + r.cost!, 0) / known.reduce((s, r) => s + pricedTokens(r.calls), 0) : null;
  const cost = (r: Run) => r.cost ?? (rate === null ? null : pricedTokens(r.calls) * rate);
  const sum = (r: Run, f: "write" | "read" | "output") => r.calls.reduce((s, c) => s + c[f], 0);
  const money = (n: number | null, digits = 2) => (n === null ? "-" : `$${n.toFixed(digits)}`);

  const modes = [...new Set(runs.map((r) => r.mode))];
  const perMode = modes.map((mode) => {
    const rs = runs.filter((r) => r.mode === mode);
    const avg = (f: (r: Run) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
    return {
      mode, runs: rs.length, calls: avg((r) => r.calls.length).toFixed(1),
      "cache write": k(avg((r) => sum(r, "write"))), "cache read": k(avg((r) => sum(r, "read"))), output: k(avg((r) => sum(r, "output"))),
      "priced tokens": k(avg((r) => pricedTokens(r.calls))), cost: money(avg((r) => cost(r) ?? 0), 3),
    };
  });

  const bySession = new Map(runs.map((r) => [r.session, r]));
  const perBatch = batches.map((b) => {
    const rs = b.sessions.map((id) => bySession.get(id)).filter((r): r is Run => r !== undefined);
    const tokens = rs.reduce((s, r) => s + pricedTokens(r.calls), 0);
    const dollars = rs.reduce((s, r) => s + (cost(r) ?? 0), 0);
    const used = sameWindow(b.before, b.after) && b.before.session !== null && b.after.session !== null ? b.after.session - b.before.session : null;
    return {
      start: new Date(b.start).toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      mode: b.mode, runs: rs.length, "US peak": usPeak(b.start) ? "yes" : "no",
      "5-hour %": `${b.before.session} -> ${b.after.session}`, "weekly %": `${b.before.week} -> ${b.after.week}`,
      cost: money(dollars), "priced tokens per 1%": used ? k(tokens / used) : "-", "$ per 1%": used ? money(dollars / used) : "-",
    };
  });

  if (markdown) {
    const table = (rows: Record<string, unknown>[]) => {
      const keys = Object.keys(rows[0] ?? {});
      return [`| ${keys.join(" | ")} |`, `|${keys.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${keys.map((key) => String(r[key])).join(" | ")} |`)].join("\n");
    };
    const info = Object.entries(setupInfo(runs)).map(([key, value]) => ({ setup: key, value }));
    console.log(`## Setup\n\n${table(info)}\n\n## Per mode\n\n${table(perMode)}\n\n## Batches\n\n${table(perBatch)}`);
  } else {
    console.table(perMode);
    if (perBatch.length) console.table(perBatch);
  }
  if (rate !== null) console.log(`Interactive costs are estimates: claude reports no cost in interactive mode, so they use the price per token of the print-mode runs.`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "usage") {
  console.log(await readUsage(setup().configDir));
} else if (cmd === "batch" && (arg === "p" || arg === "interactive")) {
  const n = process.argv[4] && !process.argv[4].startsWith("--") ? Number(process.argv[4]) : 7;
  await batch(arg, n, setup());
} else if (cmd === "run") {
  const runs = Number(option("runs") ?? 7);
  const rounds = Number(option("rounds") ?? 2);
  const s = setup();
  for (let round = 0; round < rounds; round++) {
    // The order turns each round, so neither mode always runs first in the window.
    const order: Mode[] = round % 2 === 0 ? ["p", "interactive"] : ["interactive", "p"];
    for (const mode of order) if (!(await batch(mode, runs, s))) process.exit(1);
  }
} else if (cmd === "report") {
  report(process.argv.includes("--markdown"));
} else {
  console.log("usage: pnpm bench usage | batch <p|interactive> [n] | run [--runs 7] [--rounds 2] | report [--markdown]  [--config-dir <folder>]");
  process.exit(1);
}
