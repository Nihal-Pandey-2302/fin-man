import { and, desc, gte, lt, sql } from "drizzle-orm";
import type { Report } from "../../shared/api";
import { addDays, addMonths, daysBetween, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { budgetCycles, transactions } from "../db/schema";
import { currentCycle } from "./cycles";
import { serializeTxn, SPEND } from "./dashboard";

type Period = { startDate: string; endDate: string };

/** Cycles (newest first), with gaps before the first cycle filled by calendar months. */
async function periods(db: Db, today: string): Promise<Period[]> {
  const rows = await db.select().from(budgetCycles).orderBy(desc(budgetCycles.startDate)).limit(24).all();
  const current = await currentCycle(db, today);
  const out: Period[] = [{ startDate: current.startDate, endDate: current.endDate }];
  for (const r of rows) {
    if (r.startDate >= current.startDate) continue;
    out.push({ startDate: r.startDate, endDate: r.endDate ?? addDays(addMonths(r.startDate, 1), -1) });
  }
  // Pad with calendar months so there's always something to compare against.
  while (out.length < 6) {
    const oldest = out.at(-1)!;
    const start = addMonths(`${oldest.startDate.slice(0, 7)}-01`, oldest.startDate.endsWith("-01") ? -1 : 0);
    out.push({ startDate: start, endDate: addDays(oldest.startDate, -1) });
  }
  return out;
}

/** Monthly report (PLAN.md §5 phase 2): spend by category, top merchants, comparison with the previous period. */
export async function buildReport(db: Db, start?: string, today = istDate()): Promise<Report> {
  const list = await periods(db, today);
  const idx = Math.max(0, start ? list.findIndex((p) => p.startDate === start) : 0);
  const period = list[idx] ?? list[0];
  const previous = list[idx + 1] ?? null;
  const range = (p: Period) => and(gte(transactions.occurredAt, istDayStart(p.startDate)), lt(transactions.occurredAt, istDayStart(addDays(p.endDate, 1))));

  const sumKind = (kind: string, direction: "debit" | "credit") =>
    sql<number>`COALESCE(SUM(CASE WHEN ${transactions.kind} = ${kind} AND ${transactions.direction} = ${direction} THEN ${transactions.amountPaise} ELSE 0 END), 0)`;

  const [[totals], byCat, prevByCat, merchants, biggest] = await Promise.all([
    db.select({ spend: sql<number>`COALESCE(SUM(${SPEND}), 0)`, income: sumKind("income", "credit"), invested: sumKind("investment", "debit") }).from(transactions).where(range(period)),
    db.select({ categoryId: transactions.categoryId, spend: sql<number>`SUM(${SPEND})` }).from(transactions).where(range(period)).groupBy(transactions.categoryId).all(),
    previous
      ? db.select({ categoryId: transactions.categoryId, spend: sql<number>`SUM(${SPEND})` }).from(transactions).where(range(previous)).groupBy(transactions.categoryId).all()
      : Promise.resolve([]),
    db
      .select({ merchant: sql<string>`MIN(${transactions.merchant})`, spend: sql<number>`SUM(${SPEND})`, count: sql<number>`COUNT(*)` })
      .from(transactions)
      .where(and(range(period), sql`${transactions.merchant} IS NOT NULL`, sql`${SPEND} > 0`))
      .groupBy(sql`LOWER(${transactions.merchant})`)
      .orderBy(desc(sql`SUM(${SPEND})`))
      .limit(10)
      .all(),
    db.select().from(transactions).where(and(range(period), sql`${SPEND} > 0`)).orderBy(desc(transactions.amountPaise)).limit(5).all(),
  ]);

  const prevSpend = previous ? prevByCat.reduce((s, c) => s + c.spend, 0) : 0;
  const ids = new Set([...byCat, ...prevByCat].map((c) => c.categoryId));
  const byCategory = [...ids]
    .map((categoryId) => ({
      categoryId,
      spendPaise: byCat.find((c) => c.categoryId === categoryId)?.spend ?? 0,
      previousPaise: prevByCat.find((c) => c.categoryId === categoryId)?.spend ?? 0,
    }))
    .filter((c) => c.spendPaise !== 0 || c.previousPaise !== 0)
    .sort((a, b) => b.spendPaise - a.spendPaise);

  const lastDay = period.endDate < today ? period.endDate : today;
  return {
    ...period,
    daysElapsed: Math.max(1, daysBetween(period.startDate, lastDay) + 1),
    spendPaise: totals.spend,
    incomePaise: totals.income,
    investedPaise: totals.invested,
    previous: previous ? { ...previous, spendPaise: prevSpend } : null,
    byCategory,
    topMerchants: merchants.map((m) => ({ merchant: m.merchant, spendPaise: m.spend, count: m.count })),
    biggest: biggest.map(serializeTxn),
    periods: list,
  };
}
