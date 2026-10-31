import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { Occurrence } from "../../shared/api";
import { addDays, addMonths, daysBetween, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { accounts, autopays, transactions } from "../db/schema";
import type { ParsedNotice } from "../sms/parsers";
import { isOwnerName } from "./matcher";
import { getSetting } from "./settings";

type Autopay = typeof autopays.$inferSelect;
export const MONTHS_PER = { monthly: 1, quarterly: 3, yearly: 12 } as const;
const DATE_TOLERANCE_DAYS = 4;

export type { Occurrence };

/** Move an autopay's due date one period forward (after it's been paid). */
export async function advanceAutopay(db: Db, autopayId: number) {
  const a = await db.select().from(autopays).where(eq(autopays.id, autopayId)).get();
  if (!a) return null;
  const nextDueOn = addMonths(a.nextDueOn, MONTHS_PER[a.frequency], a.dayOfMonth);
  const [row] = await db.update(autopays).set({ nextDueOn }).where(eq(autopays.id, autopayId)).returning();
  return row;
}

const amountClose = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, Math.round(b / 100));
const mentions = (text: string | null, a: Autopay) => {
  const t = text?.toLowerCase() ?? "";
  return !!t && ((!!a.matchHint && t.includes(a.matchHint.toLowerCase())) || t.includes(a.name.toLowerCase()));
};

/**
 * Match a debit to the autopay it pays: same account, due within ±4 days, and the amount matches (±1%)
 * or the SMS names it (matchHint / name). The debit gets the autopay's category (SIPs become investments)
 * and the autopay's next due date moves one period forward.
 */
export async function matchAutopay(db: Db, txnId: number): Promise<number | null> {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t || t.direction !== "debit" || t.autopayId || t.transferGroupId) return null;
  if (t.kind !== "expense" && t.kind !== "investment") return null;
  // Money sent to yourself is a transfer, never an autopay.
  if (t.merchant && isOwnerName(t.merchant, await getSetting(db, "owner_names"))) return null;
  const date = istDate(t.occurredAt);
  const candidates = (await db.select().from(autopays).where(and(eq(autopays.accountId, t.accountId), eq(autopays.active, true))).all())
    .map((a) => ({ a, amount: amountClose(t.amountPaise, a.amountPaise), named: mentions(t.merchant, a), gap: Math.abs(daysBetween(a.nextDueOn, date)) }))
    .filter((c) => c.gap <= DATE_TOLERANCE_DAYS && (c.amount || c.named))
    .sort((x, y) => Number(y.amount && y.named) - Number(x.amount && x.named) || Number(y.amount) - Number(x.amount) || x.gap - y.gap);
  const best = candidates[0]?.a;
  if (!best) return null;

  await db
    .update(transactions)
    .set({
      autopayId: best.id,
      categoryId: best.categoryId ?? t.categoryId,
      kind: best.kind === "sip" ? "investment" : t.kind,
      status: "confirmed",
    })
    .where(eq(transactions.id, t.id));
  await advanceAutopay(db, best.id);
  return best.id;
}

/**
 * Undo a match (the debit was deleted, or edited into something else): unlink it and move the autopay's
 * due date back one period, if the advance it caused is still in place.
 */
export async function unmatchAutopay(db: Db, txn: typeof transactions.$inferSelect) {
  if (!txn.autopayId) return;
  await db.update(transactions).set({ autopayId: null }).where(eq(transactions.id, txn.id));
  const a = await db.select().from(autopays).where(eq(autopays.id, txn.autopayId)).get();
  if (!a) return;
  const previous = addMonths(a.nextDueOn, -MONTHS_PER[a.frequency], a.dayOfMonth);
  if (Math.abs(daysBetween(previous, istDate(txn.occurredAt))) <= DATE_TOLERANCE_DAYS) {
    await db.update(autopays).set({ nextDueOn: previous }).where(eq(autopays.id, a.id));
  }
}

/** Find the tracked autopay an SMS heads-up refers to (same bank, amount or payee name). */
export async function findAutopayForNotice(db: Db, notice: ParsedNotice): Promise<Autopay | null> {
  const rows = await db
    .select({ a: autopays })
    .from(autopays)
    .innerJoin(accounts, eq(accounts.id, autopays.accountId))
    .where(and(eq(accounts.institution, notice.institution), eq(autopays.active, true)))
    .all();
  const list = rows.map((r) => r.a);
  return (
    list.find((a) => amountClose(notice.amountPaise, a.amountPaise) && mentions(notice.payee, a)) ??
    list.find((a) => mentions(notice.payee, a)) ??
    list.find((a) => amountClose(notice.amountPaise, a.amountPaise) && Math.abs(daysBetween(a.nextDueOn, notice.dueOn)) <= 7) ??
    null
  );
}

/** A bank's "will be debited on <date>" heads-up confirms the exact due date of a tracked autopay. */
export async function applyAutopayNotice(db: Db, notice: ParsedNotice): Promise<number | null> {
  const a = await findAutopayForNotice(db, notice);
  if (!a) return null;
  if (notice.dueOn >= istDate() && a.nextDueOn !== notice.dueOn && Math.abs(daysBetween(a.nextDueOn, notice.dueOn)) <= 10) {
    await db.update(autopays).set({ nextDueOn: notice.dueOn }).where(eq(autopays.id, a.id));
  }
  return a.id;
}


/** Every occurrence of every active autopay within [from, to], marked paid / due / overdue. */
export async function autopayCalendar(db: Db, from: string, to: string, today = istDate()): Promise<Occurrence[]> {
  const list = await db.select().from(autopays).where(eq(autopays.active, true)).all();
  const paid = list.length
    ? await db
        .select({ id: transactions.id, autopayId: transactions.autopayId, occurredAt: transactions.occurredAt })
        .from(transactions)
        .where(
          and(
            isNotNull(transactions.autopayId),
            inArray(transactions.autopayId, list.map((a) => a.id)),
            gte(transactions.occurredAt, istDayStart(addDays(from, -DATE_TOLERANCE_DAYS - 31))),
            lte(transactions.occurredAt, istDayStart(addDays(to, DATE_TOLERANCE_DAYS + 1))),
          ),
        )
        .all()
    : [];
  const used = new Set<number>();
  const out: Occurrence[] = [];
  for (const a of list) {
    const step = MONTHS_PER[a.frequency];
    // nextDueOn is the first unpaid occurrence; earlier ones (k periods back) were paid by definition.
    let k = 0;
    while (addMonths(a.nextDueOn, -(k + 1) * step, a.dayOfMonth) >= from) k++;
    for (let i = -k; ; i++) {
      // The next occurrence is exactly nextDueOn (a bank heads-up may have moved it off dayOfMonth).
      const due = i === 0 ? a.nextDueOn : addMonths(a.nextDueOn, i * step, a.dayOfMonth);
      if (due > to) break;
      if (due < from) continue;
      // Paid occurrences link to their debit when one matched (payments can land a few days off).
      const match = paid.find(
        (p) => p.autopayId === a.id && !used.has(p.id) && Math.abs(daysBetween(due, istDate(p.occurredAt))) <= DATE_TOLERANCE_DAYS + (i < 0 ? 31 : 0),
      );
      if (match) used.add(match.id);
      const status = i < 0 ? "paid" : due < today ? "overdue" : "due";
      out.push({ autopayId: a.id, name: a.name, kind: a.kind, accountId: a.accountId, amountPaise: a.amountPaise, dueOn: due, status, transactionId: match?.id ?? null });
    }
  }
  return out.sort((x, y) => x.dueOn.localeCompare(y.dueOn));
}
