import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Dashboard } from "../../shared/api";
import { addDays, daysBetween, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { accounts, autopays, categoryBudgets, smsRaw, transactions } from "../db/schema";
import { buildAlerts, lastSmsAt } from "./alerts";
import { cycleMoney } from "./budget";
import { cardStatuses } from "./cards";
import { computeBalances } from "./balances";
import { currentCycle } from "./cycles";
import { getSetting } from "./settings";

const dayOfMonth = (date: string) => Number(date.slice(8, 10));

/**
 * Spending = expense + fee debits, minus refunds. Transfers, card payments, income and investments
 * (SIPs, stock purchases) never count, so moving money between your own accounts can't double count.
 * A payment split with friends counts only your share (the rest is an IOU, repaid as a neutral transfer).
 */
export const SPEND = sql`CASE
  WHEN ${transactions.kind} IN ('expense', 'fee') AND ${transactions.direction} = 'debit' THEN COALESCE(${transactions.sharePaise}, ${transactions.amountPaise})
  WHEN ${transactions.kind} = 'refund' AND ${transactions.direction} = 'credit' THEN -${transactions.amountPaise}
  ELSE 0 END`;


/** Spending (see SPEND) between two instants. */
export async function spentBetween(db: Db, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ spent: sql<number>`COALESCE(SUM(${SPEND}), 0)` })
    .from(transactions)
    .where(and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)));
  return row.spent;
}

export async function reviewCount(db: Db): Promise<number> {
  const [{ n }] = await db.all<{ n: number }>(sql`
    SELECT (SELECT COUNT(*) FROM ${transactions} WHERE ${transactions.status} = 'needs_review')
         + (SELECT COUNT(*) FROM ${smsRaw} WHERE ${smsRaw.parseStatus} IN ('unparsed', 'error')) AS n`);
  return n;
}

export async function buildDashboard(db: Db, now = new Date()): Promise<Dashboard> {
  const today = istDate(now);
  const cycle = await currentCycle(db, today);
  const from = istDayStart(cycle.startDate);
  const to = istDayStart(addDays(cycle.endDate, 1));
  const inCycle = and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to));

  const [money, byCategory, limits, autopayRows, recent, accountRows, buffer, review, lastSms, lastSalary] = await Promise.all([
    cycleMoney(db, cycle, today),
    db
      .select({ categoryId: transactions.categoryId, spentPaise: sql<number>`SUM(${SPEND})` })
      .from(transactions)
      .where(inCycle)
      .groupBy(transactions.categoryId)
      .having(sql`SUM(${SPEND}) <> 0`)
      .orderBy(desc(sql`SUM(${SPEND})`))
      .all(),
    cycle.id ? db.select().from(categoryBudgets).where(eq(categoryBudgets.cycleId, cycle.id)).all() : [],
    db.select().from(autopays).where(eq(autopays.active, true)).all(),
    db.select().from(transactions).orderBy(desc(transactions.occurredAt), desc(transactions.id)).limit(6).all(),
    db.select().from(accounts).where(eq(accounts.archived, false)).all(),
    getSetting(db, "liquid_buffer_paise"),
    reviewCount(db),
    lastSmsAt(db),
    db
      .select({ amountPaise: transactions.amountPaise, accountId: transactions.accountId, occurredAt: transactions.occurredAt })
      .from(transactions)
      .where(eq(transactions.incomeSource, "salary"))
      .orderBy(desc(transactions.occurredAt))
      .limit(1)
      .get(),
  ]);

  // Autopays still to be paid this cycle (overdue ones too), soonest first, for the Home list.
  const upcoming = money.upcomingAutopays
    .map((o) => ({ o, a: autopayRows.find((a) => a.id === o.autopayId) }))
    .filter((x): x is { o: (typeof money.upcomingAutopays)[number]; a: (typeof autopayRows)[number] } => !!x.a)
    .sort((x, y) => x.o.dueOn.localeCompare(y.o.dueOn));

  const balances = await computeBalances(db, accountRows, today);
  const cards = await cardStatuses(db, accountRows, balances, today);
  const alerts = await buildAlerts(db, today, { accountRows, balances, cycle, lastSms, cards });
  const liquidPaise = accountRows
    .filter((a) => a.kind !== "credit_card")
    .reduce((s, a) => s + (balances.get(a.id)?.balancePaise ?? 0), 0);

  const limitBy = new Map(limits.map((l) => [l.categoryId, l.limitPaise]));
  const spentBy = new Map(byCategory.map((c) => [c.categoryId, c.spentPaise]));
  const budgetOnly = limits.filter((l) => !spentBy.has(l.categoryId)).map((l) => ({ categoryId: l.categoryId, spentPaise: 0 }));

  return {
    today,
    cycle: {
      id: cycle.id,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      daysLeft: money.daysLeft,
      budgetPaise: cycle.budgetPaise,
      spentPaise: money.spentPaise,
      spentTodayPaise: money.spentTodayPaise,
      fixedDuePaise: money.fixedDuePaise,
      autopaysDuePaise: money.autopaysDuePaise,
      dailyAllowancePaise: money.dailyAllowancePaise,
      leftTodayPaise: money.leftTodayPaise,
      remainingPaise: money.remainingPaise,
    },
    fixed: money.fixed,
    liquidPaise,
    bufferPaise: buffer,
    byCategory: [...byCategory, ...budgetOnly].map((c) => ({ ...c, limitPaise: limitBy.get(c.categoryId ?? -1) ?? null })),
    daily: money.daily,
    upcomingAutopays: upcoming.map(({ a, o }) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(), dueOn: o.dueOn })),
    recent: recent.map(serializeTxn),
    reviewCount: review,
    lastSmsAt: lastSms?.toISOString() ?? null,
    cards,
    salary: {
      // Around payday (25th–10th) with nothing marked as salary in the last 20 days: offer to record it.
      awaiting: (dayOfMonth(today) >= 25 || dayOfMonth(today) <= 10) && (!lastSalary || daysBetween(istDate(lastSalary.occurredAt), today) > 20),
      lastPaise: lastSalary?.amountPaise ?? null,
      lastAccountId: lastSalary?.accountId ?? null,
    },
    alerts,
  };
}

export function serializeTxn(t: typeof transactions.$inferSelect) {
  return {
    ...t,
    occurredAt: t.occurredAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
