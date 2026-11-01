import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Goal, Savings } from "../../shared/api";
import { addDays, istDate, istDayStart, parseDate } from "../../shared/time";
import type { Db } from "../db";
import { accounts, goals, holdings, transactions } from "../db/schema";
import { computeBalances } from "./balances";
import { currentCycle } from "./cycles";
import { SPEND } from "./dashboard";
import { periods } from "./report";
import { getSetting } from "./settings";

type GoalRow = typeof goals.$inferSelect;

/** Whole months from `today` to `dueOn`, at least 1 (the month you're in counts). */
function monthsLeft(today: string, dueOn: string): number {
  const a = parseDate(today);
  const b = parseDate(dueOn);
  return Math.max(1, (b.y - a.y) * 12 + (b.m - a.m) + (b.d >= a.d ? 0 : -1) + 1);
}

export function goalMonthlyNeed(g: GoalRow, today: string): number {
  const left = Math.max(0, g.targetPaise - g.savedPaise);
  if (left === 0) return 0;
  if (g.monthlyPaise != null) return Math.min(g.monthlyPaise, left);
  return g.dueOn ? Math.ceil(left / monthsLeft(today, g.dueOn)) : 0;
}

export const serializeGoal = (g: GoalRow, today: string): Goal => ({
  ...g,
  createdAt: g.createdAt.toISOString(),
  updatedAt: g.updatedAt.toISOString(),
  monthlyNeedPaise: goalMonthlyNeed(g, today),
});

/**
 * "Pay yourself first": this cycle's savings against the target, the savings history, how many months of
 * spending the liquid money covers, and goals (money set aside stays in the bank, earmarked).
 */
export async function buildSavings(db: Db, today = istDate()): Promise<Savings> {
  const cycle = await currentCycle(db, today);
  const [list, accountRows, goalRows, fds, target] = await Promise.all([
    periods(db, today),
    db.select().from(accounts).where(eq(accounts.archived, false)).all(),
    db.select().from(goals).where(eq(goals.archived, false)).all(),
    db.select({ value: sql<number>`COALESCE(SUM(COALESCE(${holdings.currentValuePaise}, ${holdings.investedPaise})), 0)` }).from(holdings).where(eq(holdings.type, "fd")).get(),
    getSetting(db, "savings_target_paise"),
  ]);

  const totals = (p: { startDate: string; endDate: string }) =>
    db
      .select({
        income: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.kind} = 'income' AND ${transactions.direction} = 'credit' THEN ${transactions.amountPaise} ELSE 0 END), 0)`,
        spent: sql<number>`COALESCE(SUM(${SPEND}), 0)`,
        invested: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.kind} = 'investment' AND ${transactions.direction} = 'debit' THEN ${transactions.amountPaise} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(and(gte(transactions.occurredAt, istDayStart(p.startDate)), lt(transactions.occurredAt, istDayStart(addDays(p.endDate, 1)))))
      .get();

  // Current cycle first, then up to 6 past ones (the padded calendar months only count when they had activity).
  const all = await Promise.all(list.slice(0, 7).map(async (p) => ({ ...p, t: (await totals(p))! })));
  const [now, ...past] = all;
  const history = past
    .filter((p) => p.t.income > 0 || p.t.spent > 0)
    .map((p) => ({ startDate: p.startDate, endDate: p.endDate, incomePaise: p.t.income, spentPaise: p.t.spent, investedPaise: p.t.invested }));

  const income = now.t.income;
  const spent = now.t.spent;
  const budget = cycle.budgetPaise;

  // Emergency fund: what you could live on. Card debt isn't subtracted (it's paid from the next salary), an FD
  // held as card collateral is locked, and money set aside for goals is spoken for.
  const balances = await computeBalances(db, accountRows, today);
  const cash = accountRows.filter((a) => a.kind !== "credit_card").reduce((s, a) => s + (balances.get(a.id)?.balancePaise ?? 0), 0);
  const lien = accountRows.reduce((s, a) => s + (a.fdLienPaise ?? 0), 0);
  const earmarkedPaise = goalRows.reduce((s, g) => s + g.savedPaise, 0);
  const liquidPaise = cash + Math.max(0, (fds?.value ?? 0) - lien) - earmarkedPaise;
  // Only real cycles (salary in, money spent): a half-imported month would make the fund look huge.
  const recent = history.filter((p) => p.incomePaise > 0 && p.spentPaise > 0).slice(0, 3);
  const monthlySpendPaise = recent.length ? Math.round(recent.reduce((s, p) => s + p.spentPaise, 0) / recent.length) : budget > 0 ? budget : null;
  const basis = recent.length ? "history" : budget > 0 ? "budget" : null;

  const goalList = goalRows.map((g) => serializeGoal(g, today));
  return {
    cycle: {
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      incomePaise: income,
      spentPaise: spent,
      investedPaise: now.t.invested,
      budgetPaise: budget,
      savedSoFarPaise: income - spent,
      projectedPaise: income - Math.max(budget, spent),
      targetPaise: target,
    },
    history,
    emergency: {
      liquidPaise,
      monthlySpendPaise,
      basis,
      months: monthlySpendPaise ? Math.round((liquidPaise / monthlySpendPaise) * 10) / 10 : null,
    },
    goals: goalList,
    earmarkedPaise,
    goalsMonthlyPaise: goalList.reduce((s, g) => s + g.monthlyNeedPaise, 0),
  };
}
