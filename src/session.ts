// Reads the token use of a session from the session file that Claude Code writes (<config dir>/projects/*/<id>.jsonl).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Call {
  model: string;
  input: number;
  write: number;
  read: number;
  output: number;
}

/** The session file of a session id, or undefined when it does not exist (yet). */
export function findSessionFile(configDir: string, sessionId: string): string | undefined {
  const root = path.join(configDir, "projects");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const file = path.join(root, dir, `${sessionId}.jsonl`);
    if (statSync(path.join(root, dir)).isDirectory() && existsSync(file)) return file;
  }
  return undefined;
}

/** The API calls of a session. One call is saved on several lines (one per content block), so they are joined by id. */
export function readCalls(file: string): Call[] {
  const calls = new Map<string, Call>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let d: { type?: string; requestId?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const u = d.message?.usage;
    if (d.type !== "assistant" || !u) continue;
    calls.set(`${d.message?.id}/${d.requestId}`, {
      model: d.message?.model ?? "?",
      input: u.input_tokens ?? 0,
      write: u.cache_creation_input_tokens ?? 0,
      read: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    });
  }
  return [...calls.values()];
}

/** True when the session file holds the final answer of the run. */
export function isDone(file: string): boolean {
  return readFileSync(file, "utf8").includes('"stop_reason":"end_turn"');
}

/**
 * Tokens weighed by their price, counted as input tokens: 1-hour cache write 2x, cache read 0.1x, output 5x.
 * The same weights hold for all current Claude models, so this compares runs without a price table.
 */
export function pricedTokens(calls: Call[]): number {
  return calls.reduce((sum, c) => sum + c.input + c.write * 2 + c.read * 0.1 + c.output * 5, 0);
}
