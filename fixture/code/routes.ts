// HTTP routes for the credit ledger, written for a minimal router.
// This file is part of the benchmark fixture. It is read by the benchmark task and is never run.
import { Ledger, LedgerError, summary } from "./ledger.ts";

export interface Request {
  method: "GET" | "POST";
  path: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
  user: { id: string; admin: boolean } | null;
}

export interface Response {
  status: number;
  body: unknown;
}

type Handler = (req: Request) => Response;

const ledger = new Ledger();

function ok(body: unknown): Response {
  return { status: 200, body };
}

function fail(status: number, message: string): Response {
  return { status, body: { error: message } };
}

/** Only the account owner or an admin may see or change an account. */
function allowed(req: Request, accountId: string): boolean {
  return req.user !== null && (req.user.admin || req.user.id === accountId);
}

function amountOf(req: Request): number | null {
  const amount = req.body.amount;
  return typeof amount === "number" && Number.isInteger(amount) ? amount : null;
}

/** Wraps a handler so that ledger errors become 400 responses. */
function safe(handler: Handler): Handler {
  return (req) => {
    try {
      return handler(req);
    } catch (err) {
      if (err instanceof LedgerError) return fail(400, err.message);
      throw err;
    }
  };
}

export const routes: Record<string, Handler> = {
  "GET /accounts/:id/balance": (req) => {
    const id = req.params.id!;
    if (!allowed(req, id)) return fail(403, "not your account");
    return ok({ balance: ledger.balance(id) });
  },

  "GET /accounts/:id/summary": (req) => {
    const id = req.params.id!;
    if (!allowed(req, id)) return fail(403, "not your account");
    return ok(summary(ledger, id));
  },

  "POST /accounts/:id/grant": safe((req) => {
    if (!req.user?.admin) return fail(403, "only an admin may grant credits");
    const amount = amountOf(req);
    if (amount === null) return fail(400, "amount must be a whole number");
    return ok(ledger.grant(req.params.id!, amount, typeof req.body.note === "string" ? req.body.note : null));
  }),

  "POST /accounts/:id/spend": safe((req) => {
    const id = req.params.id!;
    if (!allowed(req, id)) return fail(403, "not your account");
    const amount = amountOf(req);
    if (amount === null) return fail(400, "amount must be a whole number");
    return ok(ledger.spend(id, amount));
  }),

  "POST /entries/:id/refund": safe((req) => {
    if (!req.user?.admin) return fail(403, "only an admin may refund");
    return ok(ledger.refund(Number(req.params.id)));
  }),
};

export function handle(req: Request): Response {
  for (const [key, handler] of Object.entries(routes)) {
    const [method, pattern] = key.split(" ") as [string, string];
    if (method !== req.method) continue;
    const names: string[] = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_m, name: string) => (names.push(name), "([^/]+)"))}$`);
    const match = req.path.match(regex);
    if (!match) continue;
    names.forEach((name, i) => (req.params[name] = match[i + 1]!));
    return handler(req);
  }
  return fail(404, "no such route");
}
