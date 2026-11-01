import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { istDate } from "../../shared/time";
import type { Db } from "../db";
import { loanPayments, loans, transactions } from "../db/schema";
import { tokens } from "./matcher";

type Txn = typeof transactions.$inferSelect;
export class LoanError extends Error {}

/** Open / partly paid / settled, from the payments recorded against it. */
export async function refreshLoanStatus(db: Db, loanId: number) {
  const loan = await db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return;
  const paid = await paidOn(db, loanId);
  const status = paid >= loan.principalPaise ? "settled" : paid > 0 ? "partially_paid" : "open";
  if (status !== loan.status) await db.update(loans).set({ status }).where(eq(loans.id, loanId));
}

async function paidOn(db: Db, loanId: number) {
  const [{ paid }] = await db
    .select({ paid: sql<number>`COALESCE(SUM(${loanPayments.amountPaise}), 0)` })
    .from(loanPayments)
    .where(eq(loanPayments.loanId, loanId));
  return paid;
}

/**
 * Does a bank-printed name ("RAHUL SHARMA") belong to the friend as the owner typed them ("Rahul")? Every
 * word typed must match a distinct printed word: exactly, as an initial ("Rahul S"), or as a bank-truncated
 * prefix of ≥ 4 letters. The opposite direction of isOwnerName, where the printed name is the short one.
 */
export function personMatches(printed: string, person: string): boolean {
  const free = tokens(printed);
  const wanted = tokens(person);
  if (wanted.length === 0) return false;
  let exact = 0;
  for (const w of wanted) {
    const i = free.findIndex((p) => p === w || (w.length === 1 && p.startsWith(w)) || (p.length >= 4 && w.startsWith(p)));
    if (i < 0) return false;
    if (free[i] === w) exact++;
    free.splice(i, 1);
  }
  return exact >= 1;
}

// ---------------- split a payment with friends ----------------

/**
 * "Paid ₹1,200 for three": your share stays spending, each friend's part becomes an IOU (they owe you),
 * linked to the payment. Re-splitting replaces the old split as long as nobody has paid back yet.
 */
export async function splitTxn(db: Db, txnId: number, friends: { person: string; amountPaise: number }[]) {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t) return null;
  if (t.direction !== "debit" || (t.kind !== "expense" && t.kind !== "fee") || t.transferGroupId) throw new LoanError("Only a payment you made can be split.");
  const owed = friends.reduce((s, f) => s + f.amountPaise, 0);
  if (owed <= 0 || owed > t.amountPaise) throw new LoanError("Friends' parts must add up to no more than the payment.");
  await unsplitTxn(db, t);
  await db.insert(loans).values(
    friends.map((f) => ({
      person: f.person.trim(),
      direction: "they_owe" as const,
      principalPaise: f.amountPaise,
      reason: t.merchant ?? t.note ?? "Split payment",
      openedOn: istDate(t.occurredAt),
      splitTxnId: t.id,
    })),
  );
  const [row] = await db.update(transactions).set({ sharePaise: t.amountPaise - owed }).where(eq(transactions.id, t.id)).returning();
  return row;
}

/** Undo a split: its IOUs go, and the whole payment is your spending again. Refused once someone paid back. */
export async function unsplitTxn(db: Db, t: Txn) {
  const split = await db.select({ id: loans.id }).from(loans).where(eq(loans.splitTxnId, t.id)).all();
  if (split.length) {
    const ids = split.map((l) => l.id);
    const paid = await db.select({ id: loanPayments.id }).from(loanPayments).where(inArray(loanPayments.loanId, ids)).limit(1).get();
    if (paid) throw new LoanError("Someone already paid back part of this split; remove their payment first.");
    await db.delete(loans).where(inArray(loans.id, ids));
  }
  if (t.sharePaise !== null) await db.update(transactions).set({ sharePaise: null }).where(eq(transactions.id, t.id));
}

export async function splitOf(db: Db, txnId: number) {
  const rows = await db.select().from(loans).where(eq(loans.splitTxnId, txnId)).orderBy(asc(loans.id)).all();
  return Promise.all(rows.map(async (l) => ({ ...l, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(), paidPaise: await paidOn(db, l.id) })));
}

// ---------------- paybacks ----------------

/**
 * This transaction pays back an IOU: a friend returning money (credit, they_owe) or you repaying one (debit,
 * you_owe). It becomes neither income nor spending (kind transfer with loanId) and counts against the IOU.
 */
export async function linkRepayment(db: Db, txnId: number, loanId: number) {
  const [t, loan] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.id, txnId)).get(),
    db.select().from(loans).where(eq(loans.id, loanId)).get(),
  ]);
  if (!t || !loan) return null;
  const wantDirection = loan.direction === "they_owe" ? "credit" : "debit";
  if (t.direction !== wantDirection) throw new LoanError(loan.direction === "they_owe" ? "Pick money you received." : "Pick money you paid.");
  if (t.transferGroupId) throw new LoanError("This is a transfer between your own accounts.");
  if (t.loanId && t.loanId !== loanId) await unlinkRepayment(db, t);
  if (t.loanId !== loanId) {
    if (t.amountPaise > loan.principalPaise - (await paidOn(db, loan.id))) throw new LoanError("That's more than what's still owed.");
    await db.insert(loanPayments).values({ loanId, amountPaise: t.amountPaise, paidOn: istDate(t.occurredAt), transactionId: t.id, note: "Linked payment" });
  }
  const [row] = await db
    .update(transactions)
    .set({ kind: "transfer", loanId, categoryId: null, incomeSource: null, status: "confirmed" })
    .where(eq(transactions.id, t.id))
    .returning();
  await refreshLoanStatus(db, loanId);
  return row;
}

/** Undo a payback link (the transaction was edited or deleted): the IOU is owed again. */
export async function unlinkRepayment(db: Db, t: Txn) {
  if (!t.loanId) return;
  await db.delete(loanPayments).where(eq(loanPayments.transactionId, t.id));
  await db.update(transactions).set({ loanId: null }).where(eq(transactions.id, t.id));
  await refreshLoanStatus(db, t.loanId);
}

/**
 * New SMS money from or to a friend with an open IOU: link it automatically when exactly one friend fits
 * (the name matches and the amount is no more than what's left). Anything less certain stays for review.
 */
export async function matchRepayment(db: Db, txnId: number): Promise<number | null> {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t?.merchant || t.loanId || t.transferGroupId || t.autopayId || t.incomeSource === "salary") return null;
  if (!(t.direction === "credit" ? t.kind === "income" : t.kind === "expense")) return null;
  const direction = t.direction === "credit" ? "they_owe" : "you_owe";
  const open = await db.select().from(loans).where(and(eq(loans.direction, direction), ne(loans.status, "settled"))).orderBy(asc(loans.openedOn), asc(loans.id)).all();
  const named = open.filter((l) => personMatches(t.merchant!, l.person));
  // Two different friends could fit the name: don't guess.
  if (new Set(named.map((l) => l.person.trim().toLowerCase())).size !== 1) return null;
  for (const l of named) {
    if (t.amountPaise <= l.principalPaise - (await paidOn(db, l.id))) {
      await linkRepayment(db, t.id, l.id);
      return l.id;
    }
  }
  return null;
}
