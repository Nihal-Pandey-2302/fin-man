import { and, between, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../db";
import { accounts, transactions } from "../db/schema";
import { getSetting } from "./settings";

const WINDOW_MS = 2 * 86_400_000;
type Txn = typeof transactions.$inferSelect;

export type PairOutcome =
  | { paired: false; reason: "not_pairable" | "no_candidate" | "ambiguous" }
  | { paired: true; kind: "transfer" | "card_payment"; groupId: string; counterpartId: number; confident: boolean };

const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * Does a bank-printed name refer to the owner? Strict on purpose (a false match hides a real expense):
 * the name needs ≥ 2 tokens, each matching a distinct token of one owner variant either exactly, as a
 * single-letter initial ("NIHAL P"), or as a bank-truncated prefix of ≥ 4 letters ("PANDE"); and at least
 * one token must match exactly. "NIHAL KAPOOR" never matches "Nihal K Pandey".
 */
export function isOwnerName(name: string, ownerNames: string[]): boolean {
  const printed = tokens(name);
  if (printed.length < 2) return false;
  return ownerNames.some((owner) => {
    const free = tokens(owner);
    let exact = 0;
    for (const t of printed) {
      const i = free.findIndex((o) => o === t || (t.length === 1 && o.startsWith(t)) || (t.length >= 4 && o.startsWith(t)));
      if (i < 0) return false;
      if (free[i] === t) exact++;
      free.splice(i, 1);
    }
    return exact >= 1;
  });
}

const CARD_PAYEE = /credit ?card|\bcard\b|\bcred\b|bill ?desk|idfc first/i;

/** A rule- or owner-decided transaction is not a pairing candidate. */
const isPairable = (t: Txn) =>
  t.transferGroupId === null &&
  (t.kind === "expense" || t.kind === "income" || t.kind === "refund") &&
  !(t.status === "confirmed" && t.categoryId !== null);

/**
 * Pair a transaction with its other leg (own-account transfer, or bank → credit card bill payment):
 * opposite direction, different account, same amount, within ±2 days. Exactly one candidate is required;
 * the pair is confirmed only when neither side names a third party, otherwise it goes to the review inbox.
 */
export async function pairTransaction(db: Db, txnId: number): Promise<PairOutcome> {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t || !isPairable(t)) return { paired: false, reason: "not_pairable" };

  const at = t.occurredAt.getTime();
  const candidates = (
    await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.amountPaise, t.amountPaise),
          between(transactions.occurredAt, new Date(at - WINDOW_MS), new Date(at + WINDOW_MS)),
          ne(transactions.direction, t.direction),
          ne(transactions.accountId, t.accountId),
          isNull(transactions.transferGroupId),
        ),
      )
      .all()
  ).filter(isPairable);

  if (candidates.length === 0) return { paired: false, reason: "no_candidate" };
  if (candidates.length > 1) return { paired: false, reason: "ambiguous" };
  const c = candidates[0];

  const [debit, credit] = t.direction === "debit" ? [t, c] : [c, t];
  const accs = await db
    .select({ id: accounts.id, kind: accounts.kind })
    .from(accounts)
    .where(inArray(accounts.id, [debit.accountId, credit.accountId]))
    .all();
  const kindOf = (id: number) => accs.find((a) => a.id === id)?.kind;
  const debitKind = kindOf(debit.accountId);
  const creditKind = kindOf(credit.accountId);

  let kind: "transfer" | "card_payment";
  if (creditKind === "credit_card" && debitKind !== "credit_card") kind = "card_payment";
  else if (creditKind !== "credit_card" && debitKind !== "credit_card") kind = "transfer";
  else return { paired: false, reason: "not_pairable" };

  const ownerNames = await getSetting(db, "owner_names");
  const neutral = (name: string | null) => name === null || isOwnerName(name, ownerNames);
  const confident =
    neutral(credit.merchant) &&
    (neutral(debit.merchant) || (kind === "card_payment" && CARD_PAYEE.test(debit.merchant ?? "")));

  const groupId = crypto.randomUUID();
  await db
    .update(transactions)
    .set({
      kind,
      transferGroupId: groupId,
      categoryId: null,
      incomeSource: null,
      status: confident ? "confirmed" : "needs_review",
    })
    .where(inArray(transactions.id, [debit.id, credit.id]));

  return { paired: true, kind, groupId, counterpartId: c.id, confident };
}

/** Undo a pairing: both legs go back to plain expense/income for the owner to categorise. */
export async function unpairGroup(db: Db, groupId: string) {
  const legs = await db.select().from(transactions).where(eq(transactions.transferGroupId, groupId)).all();
  for (const leg of legs) {
    await db
      .update(transactions)
      .set({ transferGroupId: null, kind: leg.direction === "debit" ? "expense" : "income", status: "needs_review" })
      .where(eq(transactions.id, leg.id));
  }
}
