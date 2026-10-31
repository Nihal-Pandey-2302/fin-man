import { and, desc, eq, lte } from "drizzle-orm";
import { daysBetween, istDate } from "../../shared/time";
import type { Db } from "../db";
import { accounts, budgetCycles, categories, transactions } from "../db/schema";
import { startCycle } from "./cycles";
import { getSettings } from "./settings";

/** Salary usually lands between the 28th and the 7th (PLAN.md §5, phase 2). */
export const inSalaryWindow = (date: string) => {
  const day = Number(date.slice(8, 10));
  return day >= 28 || day <= 7;
};

/**
 * Recognise a salary credit and start a new budget cycle from its date.
 * Salary = a credit the owner marked as salary, or (automatically) an income credit to the salary account
 * of at least `salary_min_paise`, inside the 28th–7th window, whose sender contains `salary_employer`
 * (when set). The new cycle carries over the previous cycle's planned spend.
 */
export async function detectSalary(db: Db, txnId: number): Promise<{ cycleId: number } | null> {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t || t.direction !== "credit" || t.transferGroupId) return null;

  const explicit = t.kind === "income" && t.incomeSource === "salary";
  if (!explicit) {
    const [account, s] = await Promise.all([db.select().from(accounts).where(eq(accounts.id, t.accountId)).get(), getSettings(db)]);
    const employer = s.salary_employer.trim().toLowerCase();
    const auto =
      account?.role === "salary" &&
      t.kind === "income" &&
      t.categoryId === null &&
      s.salary_min_paise > 0 &&
      t.amountPaise >= s.salary_min_paise &&
      inSalaryWindow(istDate(t.occurredAt)) &&
      (!employer || (t.merchant ?? "").toLowerCase().includes(employer));
    if (!auto) return null;
    const salaryCat = await db.select({ id: categories.id }).from(categories).where(eq(categories.name, "Salary")).get();
    await db
      .update(transactions)
      .set({ incomeSource: "salary", categoryId: salaryCat?.id ?? null, status: "confirmed" })
      .where(eq(transactions.id, t.id));
  }

  const linked = await db.select({ id: budgetCycles.id }).from(budgetCycles).where(eq(budgetCycles.salaryTxnId, t.id)).get();
  if (linked) return { cycleId: linked.id };

  const date = istDate(t.occurredAt);
  const latest = await db.select().from(budgetCycles).where(lte(budgetCycles.startDate, date)).orderBy(desc(budgetCycles.startDate)).limit(1).get();
  // A cycle the owner started by hand a few days before payday becomes this salary's cycle.
  if (latest && !latest.salaryTxnId && daysBetween(latest.startDate, date) <= 7) {
    await db.update(budgetCycles).set({ salaryTxnId: t.id, incomePaise: t.amountPaise }).where(and(eq(budgetCycles.id, latest.id)));
    return { cycleId: latest.id };
  }
  const row = await startCycle(db, {
    startDate: date,
    plannedSpendPaise: latest?.plannedSpendPaise ?? 0,
    incomePaise: t.amountPaise,
    salaryTxnId: t.id,
  });
  return { cycleId: row.id };
}
