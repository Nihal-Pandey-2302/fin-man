import { and, desc, isNull, lt, lte, or, sql } from "drizzle-orm";
import { addDays, addMonths, istDate, parseDate } from "../../shared/time";
import type { Db } from "../db";
import { budgetCycles } from "../db/schema";

export type CurrentCycle = {
  id: number | null;
  startDate: string;
  /** Inclusive. */
  endDate: string;
  budgetPaise: number;
};

/**
 * The cycle containing `today`: the latest budget cycle that has started. An open cycle runs until the day
 * before the same date next month (salary detection closes it earlier when the next salary lands). If that
 * has passed with no newer cycle, monthly periods roll forward from its start date with the same budget
 * (id null: not a stored cycle). Without any cycle, falls back to the calendar month with no budget.
 */
export async function currentCycle(db: Db, today = istDate()): Promise<CurrentCycle> {
  const row = await db
    .select()
    .from(budgetCycles)
    .where(lte(budgetCycles.startDate, today))
    .orderBy(desc(budgetCycles.startDate))
    .limit(1)
    .get();

  if (row) {
    const end = row.endDate ?? addDays(addMonths(row.startDate, 1), -1);
    if (end >= today) return { id: row.id, startDate: row.startDate, endDate: end, budgetPaise: row.plannedSpendPaise };
    let n = 1;
    while (addDays(addMonths(row.startDate, n + 1), -1) < today) n++;
    return {
      id: null,
      startDate: addMonths(row.startDate, n),
      endDate: addDays(addMonths(row.startDate, n + 1), -1),
      budgetPaise: row.plannedSpendPaise,
    };
  }
  const { y, m } = parseDate(today);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  return { id: null, startDate: start, endDate: addDays(addMonths(start, 1), -1), budgetPaise: 0 };
}

/** Start (or update) the cycle beginning on `startDate`; the previous open cycle ends the day before. */
export async function startCycle(db: Db, body: { startDate: string; plannedSpendPaise: number; incomePaise?: number; salaryTxnId?: number | null }) {
  const [row] = await db
    .insert(budgetCycles)
    .values(body)
    .onConflictDoUpdate({
      target: budgetCycles.startDate,
      set: {
        plannedSpendPaise: body.plannedSpendPaise,
        ...(body.incomePaise !== undefined && { incomePaise: body.incomePaise }),
        ...(body.salaryTxnId !== undefined && { salaryTxnId: body.salaryTxnId }),
      },
    })
    .returning();
  const dayBefore = addDays(body.startDate, -1);
  await db
    .update(budgetCycles)
    .set({ endDate: dayBefore })
    .where(and(lt(budgetCycles.startDate, body.startDate), or(isNull(budgetCycles.endDate), sql`${budgetCycles.endDate} > ${dayBefore}`)));
  return row;
}
