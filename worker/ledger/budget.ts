import { and, gte, isNull, lt, notInArray, sql } from "drizzle-orm";
import { addDays, daysBetween, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { transactions } from "../db/schema";
import { autopayCalendar } from "./autopays";
import type { CurrentCycle } from "./cycles";
import { SPEND } from "./dashboard";
import { getSetting } from "./settings";

/** IST calendar day of a transaction, as YYYY-MM-DD. */
const istDay = sql<string>`date((${transactions.occurredAt} + 19800000) / 1000, 'unixepoch')`;

export type FixedCost = { name: string; categoryId: number; amountPaise: number };

/**
 * The cycle's money, the one place it's worked out (Home, the salary-day plan, the digest):
 *
 * - Fixed costs (rent…) are set aside up front. They're matched by category, so they count from whichever
 *   account and in however many payments; paying them never moves the daily number (only paying more does).
 * - Autopays (scooty rent, EMIs…) are set aside the same way until a debit is matched to them, overdue ones
 *   included. SIPs are investments, not spending, so they're left out like everywhere else.
 * - Everything else is day-to-day spending: the daily allowance is what's left of the budget for it,
 *   spread over the days left (counted from the start of today, so today's own spending shows against it).
 */
export async function cycleMoney(db: Db, cycle: Pick<CurrentCycle, "startDate" | "endDate" | "budgetPaise">, today: string) {
  const from = istDayStart(cycle.startDate);
  const to = istDayStart(addDays(cycle.endDate, 1));
  const inCycle = and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to));
  const fixed = await getSetting(db, "fixed_costs");
  const fixedCategories = fixed.map((f) => f.categoryId);

  const [byCategory, dailyRows, occurrences] = await Promise.all([
    db
      .select({ categoryId: transactions.categoryId, spentPaise: sql<number>`COALESCE(SUM(${SPEND}), 0)` })
      .from(transactions)
      .where(inCycle)
      .groupBy(transactions.categoryId)
      .all(),
    // Day-to-day spending per day: not a fixed cost, not an autopay payment.
    db
      .select({ date: istDay, spentPaise: sql<number>`SUM(${SPEND})` })
      .from(transactions)
      .where(
        and(
          inCycle,
          isNull(transactions.autopayId),
          fixedCategories.length ? sql`(${transactions.categoryId} IS NULL OR ${notInArray(transactions.categoryId, fixedCategories)})` : undefined,
        ),
      )
      .groupBy(istDay)
      .orderBy(istDay)
      .all(),
    autopayCalendar(db, cycle.startDate, cycle.endDate, today),
  ]);

  const spentPaise = byCategory.reduce((s, c) => s + c.spentPaise, 0);
  const spentIn = (categoryId: number) => byCategory.find((c) => c.categoryId === categoryId)?.spentPaise ?? 0;
  const fixedStatus = fixed.map((f) => ({ ...f, paidPaise: Math.max(0, spentIn(f.categoryId)) }));
  const fixedDuePaise = fixedStatus.reduce((s, f) => s + Math.max(0, f.amountPaise - f.paidPaise), 0);
  // Still to come (shown on Home, SIPs included); only non-SIP ones are set aside from spending.
  const upcoming = occurrences.filter((o) => o.status !== "paid");
  const autopaysDuePaise = upcoming.filter((o) => o.kind !== "sip").reduce((s, o) => s + o.amountPaise, 0);

  const daily = dailyRows.map((d) => ({ date: d.date, spentPaise: d.spentPaise }));
  const spentTodayPaise = daily.find((d) => d.date === today)?.spentPaise ?? 0;
  const daysLeft = Math.max(1, daysBetween(today, cycle.endDate) + 1);
  const remainingPaise = cycle.budgetPaise - spentPaise - fixedDuePaise - autopaysDuePaise;
  const dailyAllowancePaise = Math.max(0, Math.floor((remainingPaise + spentTodayPaise) / daysLeft));

  return {
    spentPaise,
    spentTodayPaise,
    fixed: fixedStatus,
    fixedDuePaise,
    autopaysDuePaise,
    upcomingAutopays: upcoming,
    daily,
    daysLeft,
    remainingPaise,
    dailyAllowancePaise,
    leftTodayPaise: dailyAllowancePaise - spentTodayPaise,
  };
}
