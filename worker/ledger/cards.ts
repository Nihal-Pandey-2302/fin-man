import { and, desc, eq, gte, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import type { AccountBalance, CardStatus } from "../../shared/api";
import { addDays, addMonths, daysBetween, istDate, istDayStart, nextDayOfMonth, parseDate } from "../../shared/time";
import type { Db } from "../db";
import { type accounts, cardStatements, transactions } from "../db/schema";

type AccountRow = typeof accounts.$inferSelect;

/** The most recent statement date on or before `today` (day clamped to short months). */
export function lastStatementDate(today: string, statementDay: number): string {
  const { y, m } = parseDate(today);
  const thisMonth = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, 0, statementDay);
  return thisMonth <= today ? thisMonth : addMonths(thisMonth, -1, statementDay);
}

/** A statement is due on the first `dueDay` after it (e.g. statement 20 Oct, due day 4 → 4 Nov). */
export const dueDateFor = (statementDate: string, dueDay: number) => nextDayOfMonth(addDays(statementDate, 1), dueDay);

const signedOutstanding = sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'debit' THEN ${transactions.amountPaise} ELSE -${transactions.amountPaise} END), 0)`;

/**
 * Outstanding at the end of the statement day, from the ledger: start at the last known figure on or before
 * that moment (a card SMS's available limit, or the balance the owner entered) and add the card's
 * transactions up to the cut-off. Null when no figure that old exists (history not imported yet).
 */
async function outstandingAt(db: Db, card: AccountRow, cutoff: Date): Promise<number | null> {
  const sms =
    card.creditLimitPaise == null
      ? undefined
      : await db
          .select({ id: transactions.id, at: transactions.occurredAt, avail: transactions.availableLimitPaise })
          .from(transactions)
          .where(and(eq(transactions.accountId, card.id), isNotNull(transactions.availableLimitPaise), lte(transactions.occurredAt, cutoff)))
          .orderBy(desc(transactions.occurredAt), desc(transactions.id))
          .limit(1)
          .get();
  const opening = card.openingBalanceAt && card.openingBalanceAt <= cutoff ? card.openingBalanceAt : null;

  let base: number;
  let after: SQL | undefined;
  if (sms && (!opening || sms.at >= opening)) {
    base = card.creditLimitPaise! - sms.avail!;
    // Transactions after that SMS (same instant: higher id), up to the cut-off.
    after = sql`(${transactions.occurredAt} > ${sms.at.getTime()} OR (${transactions.occurredAt} = ${sms.at.getTime()} AND ${transactions.id} > ${sms.id}))`;
  } else if (opening) {
    base = card.openingBalancePaise;
    after = gte(transactions.occurredAt, opening);
  } else {
    return null;
  }
  const [row] = await db
    .select({ net: signedOutstanding })
    .from(transactions)
    .where(and(eq(transactions.accountId, card.id), after, lte(transactions.occurredAt, cutoff)));
  return base + row.net;
}

export async function cardStatus(db: Db, card: AccountRow, balance: AccountBalance | undefined, today = istDate()): Promise<CardStatus> {
  const outstandingPaise = balance?.balancePaise ?? 0;
  const limitPaise = card.creditLimitPaise;
  const base = {
    accountId: card.id,
    outstandingPaise,
    limitPaise,
    utilization: limitPaise ? Math.max(0, outstandingPaise) / limitPaise : null,
  };
  if (!card.statementDay) {
    return { ...base, statementDate: null, dueDate: null, statementPaise: null, statementSource: null, minDuePaise: null, paidPaise: 0, leftToPayPaise: null, status: "unknown", daysToDue: null, spentSincePaise: 0 };
  }

  const statementDate = lastStatementDate(today, card.statementDay);
  const dueDate = card.dueDay ? dueDateFor(statementDate, card.dueDay) : null;
  // The statement covers its whole day; anything from the next day on belongs to the next bill.
  const nextDay = istDayStart(addDays(statementDate, 1));

  const [bank, since] = await Promise.all([
    db.select().from(cardStatements).where(and(eq(cardStatements.accountId, card.id), eq(cardStatements.statementDate, statementDate))).get(),
    db
      .select({
        paid: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.kind} = 'card_payment' AND ${transactions.direction} = 'credit' THEN ${transactions.amountPaise} ELSE 0 END), 0)`,
        spent: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'debit' THEN ${transactions.amountPaise} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.accountId, card.id), gte(transactions.occurredAt, nextDay)))
      .get(),
  ]);

  let statementPaise: number | null = bank?.amountPaise ?? null;
  let statementSource: CardStatus["statementSource"] = bank ? "bank" : null;
  if (statementPaise === null) {
    const computed = await outstandingAt(db, card, new Date(nextDay.getTime() - 1));
    if (computed !== null) {
      statementPaise = Math.max(0, computed);
      statementSource = "computed";
    }
  }

  const paidPaise = since?.paid ?? 0;
  const leftToPayPaise = statementPaise === null ? null : Math.max(0, statementPaise - paidPaise);
  const daysToDue = dueDate ? daysBetween(today, dueDate) : null;
  const status: CardStatus["status"] =
    statementPaise === null
      ? "unknown"
      : statementPaise === 0
        ? "nothing_due"
        : leftToPayPaise! <= 100
          ? "paid"
          : daysToDue !== null && daysToDue < 0
            ? "overdue"
            : "due";

  return {
    ...base,
    statementDate,
    dueDate,
    statementPaise,
    statementSource,
    minDuePaise: bank?.minDuePaise ?? null,
    paidPaise,
    leftToPayPaise,
    status,
    daysToDue,
    spentSincePaise: since?.spent ?? 0,
  };
}

export async function cardStatuses(db: Db, rows: AccountRow[], balances: Map<number, AccountBalance>, today = istDate()) {
  return Promise.all(rows.filter((a) => a.kind === "credit_card" && !a.archived).map((a) => cardStatus(db, a, balances.get(a.id), today)));
}

/** The owner enters (or corrects) what a statement asks for. */
export async function setStatement(db: Db, accountId: number, statementDate: string, amountPaise: number, minDuePaise: number | null) {
  const [row] = await db
    .insert(cardStatements)
    .values({ accountId, statementDate, amountPaise, minDuePaise })
    .onConflictDoUpdate({ target: [cardStatements.accountId, cardStatements.statementDate], set: { amountPaise, minDuePaise, updatedAt: new Date() } })
    .returning();
  return row;
}

