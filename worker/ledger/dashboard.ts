import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Dashboard } from "../../shared/api";
import { addDays, daysBetween, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { accounts, autopays, categoryBudgets, smsRaw, transactions } from "../db/schema";
import { computeBalances } from "./balances";
import { currentCycle } from "./cycles";
import { getSetting } from "./settings";

/**
 * Spending = expense + fee debits, minus refunds. Transfers, card payments, income and investments
 * (SIPs, stock purchases) never count, so moving money between your own accounts can't double count.
 */
const SPEND = sql`CASE
  WHEN ${transactions.kind} IN ('expense', 'fee') AND ${transactions.direction} = 'debit' THEN ${transactions.amountPaise}
  WHEN ${transactions.kind} = 'refund' AND ${transactions.direction} = 'credit' THEN -${transactions.amountPaise}
  ELSE 0 END`;

/** IST calendar day of an epoch-ms column, as YYYY-MM-DD. */
const istDay = sql<string>`date((${transactions.occurredAt} + 19800000) / 1000, 'unixepoch')`;

export async function reviewCount(db: Db): Promise<number> {
  const [{ n }] = await db.all<{ n: number }>(sql`
    SELECT (SELECT COUNT(*) FROM ${transactions} WHERE ${transactions.status} = 'needs_review')
         + (SELECT COUNT(*) FROM ${smsRaw} WHERE ${smsRaw.parseStatus} = 'unparsed') AS n`);
  return n;
}

export async function buildDashboard(db: Db, now = new Date()): Promise<Dashboard> {
  const today = istDate(now);
  const cycle = await currentCycle(db, today);
  const from = istDayStart(cycle.startDate);
  const to = istDayStart(addDays(cycle.endDate, 1));
  const inCycle = and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to));

  const [daily, byCategory, limits, dueAutopays, recent, accountRows, buffer, review] = await Promise.all([
    db
      .select({ date: istDay, spentPaise: sql<number>`SUM(${SPEND})` })
      .from(transactions)
      .where(inCycle)
      .groupBy(istDay)
      .orderBy(asc(istDay))
      .all(),
    db
      .select({ categoryId: transactions.categoryId, spentPaise: sql<number>`SUM(${SPEND})` })
      .from(transactions)
      .where(inCycle)
      .groupBy(transactions.categoryId)
      .having(sql`SUM(${SPEND}) <> 0`)
      .orderBy(desc(sql`SUM(${SPEND})`))
      .all(),
    cycle.id ? db.select().from(categoryBudgets).where(eq(categoryBudgets.cycleId, cycle.id)).all() : [],
    db
      .select()
      .from(autopays)
      .where(and(eq(autopays.active, true), gte(autopays.nextDueOn, today), lte(autopays.nextDueOn, cycle.endDate)))
      .orderBy(asc(autopays.nextDueOn))
      .all(),
    db.select().from(transactions).orderBy(desc(transactions.occurredAt), desc(transactions.id)).limit(6).all(),
    db.select().from(accounts).where(eq(accounts.archived, false)).all(),
    getSetting(db, "liquid_buffer_paise"),
    reviewCount(db),
  ]);

  const spentPaise = daily.reduce((s, d) => s + d.spentPaise, 0);
  const spentTodayPaise = daily.find((d) => d.date === today)?.spentPaise ?? 0;
  // SIPs are investments, not spending: they're excluded here exactly as they are from `spent`.
  const autopaysDuePaise = dueAutopays.filter((a) => a.kind !== "sip").reduce((s, a) => s + a.amountPaise, 0);
  const daysLeft = Math.max(1, daysBetween(today, cycle.endDate) + 1);
  const remainingPaise = cycle.budgetPaise - spentPaise - autopaysDuePaise;
  const remainingAtDayStart = remainingPaise + spentTodayPaise;
  const dailyAllowancePaise = Math.max(0, Math.floor(remainingAtDayStart / daysLeft));

  const balances = await computeBalances(db, accountRows, today);
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
      daysLeft,
      budgetPaise: cycle.budgetPaise,
      spentPaise,
      spentTodayPaise,
      autopaysDuePaise,
      dailyAllowancePaise,
      leftTodayPaise: dailyAllowancePaise - spentTodayPaise,
      remainingPaise,
    },
    liquidPaise,
    bufferPaise: buffer,
    byCategory: [...byCategory, ...budgetOnly].map((c) => ({ ...c, limitPaise: limitBy.get(c.categoryId ?? -1) ?? null })),
    daily,
    upcomingAutopays: dueAutopays.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(), dueOn: a.nextDueOn })),
    recent: recent.map(serializeTxn),
    reviewCount: review,
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
