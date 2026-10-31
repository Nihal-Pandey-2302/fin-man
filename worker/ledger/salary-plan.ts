import { and, eq, gte, inArray } from "drizzle-orm";
import type { SalaryPlan } from "../../shared/api";
import { addDays, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { accounts, budgetCycles, transactions } from "../db/schema";
import { autopayCalendar } from "./autopays";
import { computeBalances } from "./balances";
import { currentCycle } from "./cycles";
import { spentBetween } from "./dashboard";
import { getSetting } from "./settings";

/**
 * Salary-day plan (PLAN.md §5 phase 2): from the salary account, pay the card bill, top up the spending
 * account to cover this cycle's budget, top up the autopay account to cover autopays due + buffer, keep the
 * rest. Each step is marked done once matching transfers have arrived since the cycle started.
 */
export async function buildSalaryPlan(db: Db, today = istDate()): Promise<SalaryPlan> {
  const cycle = await currentCycle(db, today);
  const accountRows = await db.select().from(accounts).where(eq(accounts.archived, false)).all();
  const byRole = (role: string) => accountRows.find((a) => a.role === role);
  const salary = byRole("salary");
  const spending = byRole("spending");
  const autopay = byRole("autopay");
  const card = accountRows.find((a) => a.kind === "credit_card");
  const balances = await computeBalances(db, accountRows, today);
  const bal = (id?: number) => (id ? (balances.get(id)?.balancePaise ?? 0) : 0);

  const cycleRow = cycle.id ? await db.select().from(budgetCycles).where(eq(budgetCycles.id, cycle.id)).get() : undefined;
  const occurrences = await autopayCalendar(db, cycle.startDate, cycle.endDate, today);
  const unpaid = occurrences.filter((o) => o.status !== "paid");
  const dueFromAutopay = unpaid.filter((o) => o.accountId === autopay?.id).reduce((s, o) => s + o.amountPaise, 0);
  const nonSipDue = unpaid.filter((o) => o.kind !== "sip").reduce((s, o) => s + o.amountPaise, 0);
  const autopayBuffer = await getSetting(db, "autopay_buffer_paise");

  // Money already moved out of the salary account this cycle, per destination (shown for context).
  const legs = salary
    ? await db
        .select({ groupId: transactions.transferGroupId, accountId: transactions.accountId, direction: transactions.direction, amountPaise: transactions.amountPaise })
        .from(transactions)
        .where(and(inArray(transactions.kind, ["transfer", "card_payment"]), gte(transactions.occurredAt, istDayStart(cycle.startDate))))
        .all()
    : [];
  const fromSalary = new Set(legs.filter((l) => l.accountId === salary?.id && l.direction === "debit").map((l) => l.groupId));
  const sentTo = (toId: number) =>
    legs.filter((l) => l.accountId === toId && l.direction === "credit" && fromSalary.has(l.groupId)).reduce((s, l) => s + l.amountPaise, 0);

  const spentSoFar = await spentBetween(db, istDayStart(cycle.startDate), istDayStart(addDays(today, 1)));
  const items: SalaryPlan["items"] = [];
  /** `needPaise`: what the destination still lacks right now. Done once that's (about) zero. */
  const add = (key: SalaryPlan["items"][number]["key"], label: string, toId: number | undefined, needPaise: number) => {
    if (!salary || !toId) return;
    const need = Math.max(0, needPaise);
    items.push({ key, label, fromAccountId: salary.id, toAccountId: toId, needPaise: need, sentPaise: sentTo(toId), done: need <= 100 });
  };
  if (card) add("card_bill", "Pay the credit card bill", card.id, bal(card.id));
  if (spending) add("spending", "Daily spending money", spending.id, cycle.budgetPaise - spentSoFar - nonSipDue - bal(spending.id));
  if (autopay) add("autopays", "Autopays due this cycle + buffer", autopay.id, dueFromAutopay + autopayBuffer - bal(autopay.id));

  return {
    cycleStart: cycle.startDate,
    cycleEnd: cycle.endDate,
    salaryTxnId: cycleRow?.salaryTxnId ?? null,
    salaryPaise: cycleRow?.incomePaise ?? 0,
    salaryAccountId: salary?.id ?? null,
    items,
    keepPaise: bal(salary?.id) - items.reduce((sum, i) => sum + i.needPaise, 0),
  };
}
