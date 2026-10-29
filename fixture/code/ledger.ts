// A small credit ledger: accounts hold credits, every change is an entry, and the balance is the sum of entries.
// This file is part of the benchmark fixture. It is read by the benchmark task and is never run.

export type EntryKind = "grant" | "spend" | "refund" | "expire";

export interface Entry {
  id: number;
  accountId: string;
  kind: EntryKind;
  amount: number;
  at: Date;
  note: string | null;
}

export class LedgerError extends Error {}

export class Ledger {
  private entries: Entry[] = [];
  private nextId = 1;

  /** Adds credits to an account. */
  grant(accountId: string, amount: number, note: string | null = null): Entry {
    if (amount <= 0) throw new LedgerError("a grant must be more than zero");
    return this.add(accountId, "grant", amount, note);
  }

  /** Takes credits from an account. Fails when the balance is too low. */
  spend(accountId: string, amount: number, note: string | null = null): Entry {
    if (amount <= 0) throw new LedgerError("a spend must be more than zero");
    if (this.balance(accountId) < amount) throw new LedgerError(`account ${accountId} has too few credits`);
    return this.add(accountId, "spend", -amount, note);
  }

  /** Gives back the credits of an earlier spend. A spend can be refunded only once. */
  refund(spendId: number, note: string | null = null): Entry {
    const spend = this.entries.find((e) => e.id === spendId);
    if (!spend || spend.kind !== "spend") throw new LedgerError(`entry ${spendId} is not a spend`);
    if (this.entries.some((e) => e.kind === "refund" && e.note === `refund of ${spendId}`)) {
      throw new LedgerError(`entry ${spendId} was already refunded`);
    }
    return this.add(spend.accountId, "refund", -spend.amount, note ?? `refund of ${spendId}`);
  }

  /** Removes the credits of grants that are older than the given date and not spent. */
  expire(accountId: string, before: Date): Entry | null {
    const old = this.entries
      .filter((e) => e.accountId === accountId && e.kind === "grant" && e.at < before)
      .reduce((sum, e) => sum + e.amount, 0);
    const left = Math.min(old, this.balance(accountId));
    return left > 0 ? this.add(accountId, "expire", -left, `expired before ${before.toISOString()}`) : null;
  }

  balance(accountId: string): number {
    return this.entries.filter((e) => e.accountId === accountId).reduce((sum, e) => sum + e.amount, 0);
  }

  history(accountId: string): Entry[] {
    return this.entries.filter((e) => e.accountId === accountId);
  }

  private add(accountId: string, kind: EntryKind, amount: number, note: string | null): Entry {
    const entry: Entry = { id: this.nextId++, accountId, kind, amount, at: new Date(), note };
    this.entries.push(entry);
    return entry;
  }
}

export function summary(ledger: Ledger, accountId: string): Record<EntryKind, number> {
  const totals: Record<EntryKind, number> = { grant: 0, spend: 0, refund: 0, expire: 0 };
  for (const e of ledger.history(accountId)) totals[e.kind] += Math.abs(e.amount);
  return totals;
}
