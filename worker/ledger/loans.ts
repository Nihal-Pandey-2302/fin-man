import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { istDate } from "../../shared/time";
import type { Db } from "../db";
import { loanPayments, loans, transactions } from "../db/schema";
import { unmatchAutopay } from "./autopays";
import { tokens } from "./matcher";
import { findRule, loadRules, type Rule } from "./rules";
import { unlinkSalary } from "./salary";

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

/**
 * Undo a link to an IOU (the transaction was edited or deleted). A payback stops counting, so the IOU is
 * owed again. The money that *was* the loan takes its IOU with it, unless someone already paid some back
 * (then the IOU stays, just without its origin).
 */
export async function unlinkRepayment(db: Db, t: Txn) {
  if (!t.loanId) return;
  const loan = await db.select().from(loans).where(eq(loans.id, t.loanId)).get();
  if (loan?.txnId === t.id) {
    const paid = await paidOn(db, loan.id);
    if (paid === 0) await db.delete(loans).where(eq(loans.id, loan.id));
    else await db.update(loans).set({ txnId: null }).where(eq(loans.id, loan.id));
    await db.update(transactions).set({ loanId: null }).where(eq(transactions.id, t.id));
    return;
  }
  await db.delete(loanPayments).where(eq(loanPayments.transactionId, t.id));
  await db.update(transactions).set({ loanId: null }).where(eq(transactions.id, t.id));
  await refreshLoanStatus(db, t.loanId);
}

// ---------------- borrowing and lending ----------------

/**
 * This money *is* a loan: a friend sent it to you (you owe them) or you sent it to them (they owe you).
 * It becomes neither income nor spending, an IOU opens for the full amount, and the money back is matched
 * to it by name like any payback.
 */
export async function recordLoan(db: Db, txnId: number, person: string) {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t) return null;
  if (t.transferGroupId) throw new LoanError("This is a transfer between your own accounts.");
  if (t.loanId) throw new LoanError("This is already linked to an IOU.");
  if (t.sharePaise !== null) throw new LoanError("This payment is split with friends; remove the split first.");
  if (t.kind !== "income" && t.kind !== "expense") throw new LoanError("Only money in or out can be a loan.");
  await unmatchAutopay(db, t);
  await unlinkSalary(db, t);
  const [loan] = await db
    .insert(loans)
    .values({ person: person.trim(), direction: t.direction === "credit" ? "you_owe" : "they_owe", principalPaise: t.amountPaise, openedOn: istDate(t.occurredAt), txnId: t.id })
    .returning();
  const [row] = await db
    .update(transactions)
    .set({ kind: "transfer", loanId: loan.id, categoryId: null, incomeSource: null, autopayId: null, status: "confirmed" })
    .where(eq(transactions.id, t.id))
    .returning();
  return { transaction: row, loan };
}

/** Not a loan after all: the IOU goes (refused once something was paid back) and it's plain money in / out again. */
export async function unrecordLoan(db: Db, t: Txn) {
  const loan = t.loanId ? await db.select().from(loans).where(eq(loans.id, t.loanId)).get() : null;
  if (!loan || loan.txnId !== t.id) throw new LoanError("This isn't the money a loan started with.");
  if ((await paidOn(db, loan.id)) > 0) throw new LoanError("Some of it was already paid back; remove those payments first.");
  await db.delete(loans).where(eq(loans.id, loan.id));
  const [row] = await db
    .update(transactions)
    .set({ kind: t.direction === "credit" ? "income" : "expense", loanId: null, status: "needs_review" })
    .where(eq(transactions.id, t.id))
    .returning();
  return row;
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

// ---------------- short loans, found automatically ----------------

const ROUND_TRIP_DAYS = 7;
const ROUND_TRIP_TOLERANCE = 0.05;
const ROUND_TRIP_MIN_PAISE = 50_000;

/** "ARJUN MEHRA", "Priya S": 2–4 words, letters only, and not a merchant the owner has a rule for. */
export function looksLikePerson(name: string | null, rules: Rule[]): boolean {
  if (!name) return false;
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4 || !/^[A-Za-z. ]+$/.test(name.trim())) return false;
  if (/\b(ltd|limited|pvt|private|llp|store|stores|mart|bank|pay|payments|services|enterprises|traders|foods?|retail|restaurant|cafe|hotel|nation)\b/i.test(name)) return false;
  return findRule(rules, name, null) === null;
}

const samePerson = (a: string, b: string) => personMatches(a, b) || personMatches(b, a);

/**
 * Money in from a person and about the same back to them within a week is a short loan, not income and
 * spending: "borrowed from Arjun for the rent, paid it back after salary". The credit becomes the
 * loan, this debit its repayment, and both stay in the review inbox so the owner can say "not a loan".
 * Only this direction is automatic: money out first and back later is exactly what a shop refund looks
 * like, so lending is one tap ("Lent") instead of a guess.
 */
export async function matchRoundTrip(db: Db, txnId: number): Promise<number | null> {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t || t.loanId || t.transferGroupId || t.autopayId || t.incomeSource === "salary" || t.sharePaise !== null) return null;
  if (t.direction !== "debit" || t.kind !== "expense" || t.amountPaise < ROUND_TRIP_MIN_PAISE) return null;
  const rules = await loadRules(db);
  if (!looksLikePerson(t.merchant, rules)) return null;

  const from = new Date(t.occurredAt.getTime() - ROUND_TRIP_DAYS * 86_400_000);
  const earlier = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.direction, "credit"),
        eq(transactions.kind, "income"),
        isNull(transactions.loanId),
        isNull(transactions.transferGroupId),
        isNull(transactions.autopayId),
        isNull(transactions.sharePaise),
        gte(transactions.occurredAt, from),
        lte(transactions.occurredAt, t.occurredAt),
      ),
    )
    .all();
  const fits = earlier.filter(
    (e) =>
      e.id !== t.id &&
      e.incomeSource !== "salary" &&
      e.merchant !== null &&
      samePerson(e.merchant, t.merchant!) &&
      Math.abs(e.amountPaise - t.amountPaise) <= Math.round(e.amountPaise * ROUND_TRIP_TOLERANCE),
  );
  if (fits.length !== 1) return null;
  const [origin] = fits;
  // Never more back than was lent: a little more (or less) stays as a normal transaction for the owner.
  if (t.amountPaise > origin.amountPaise) return null;

  const loan = await recordLoan(db, origin.id, origin.merchant!);
  if (!loan) return null;
  await linkRepayment(db, t.id, loan.loan.id);
  await db.update(transactions).set({ status: "needs_review" }).where(inArray(transactions.id, [origin.id, t.id]));
  return loan.loan.id;
}

/**
 * "Not a loan": undo an IOU and everything linked to it. The money it started from and every payback go back
 * to plain money in / out, waiting for a category in the review inbox.
 */
export async function unwindLoan(db: Db, loanId: number) {
  const loan = await db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return null;
  const linked = await db.select().from(transactions).where(eq(transactions.loanId, loanId)).all();
  await db.delete(loanPayments).where(eq(loanPayments.loanId, loanId));
  for (const t of linked) {
    await db
      .update(transactions)
      .set({ kind: t.direction === "credit" ? "income" : "expense", loanId: null, status: "needs_review" })
      .where(eq(transactions.id, t.id));
  }
  if (loan.splitTxnId) await db.update(transactions).set({ sharePaise: null }).where(eq(transactions.id, loan.splitTxnId));
  await db.delete(loans).where(eq(loans.id, loanId));
  return { unwound: linked.length };
}
