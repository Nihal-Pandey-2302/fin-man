// Pay yourself first: savings target, emergency-fund months, goals, and the salary plan's savings step.
import { beforeEach, describe, expect, it } from "vitest";
import type { Goal, SalaryPlan, Savings } from "../shared/api";
import { istDate } from "../shared/time";
import { goalMonthlyNeed } from "../worker/ledger/savings";
import { setSetting } from "../worker/ledger/settings";
import { api, db, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const goalRow = (over: Partial<typeof schema.goals.$inferSelect>) =>
  ({ id: 1, name: "Trip", targetPaise: 3_000_000, savedPaise: 0, dueOn: null, monthlyPaise: null, archived: false, createdAt: new Date(), updatedAt: new Date(), ...over }) as typeof schema.goals.$inferSelect;
beforeEach(async () => {
  await resetLedger();
  await db.delete(schema.goals);
});

describe("goals", () => {
  it("splits what's left over the months to go, or uses a fixed monthly amount", () => {
    expect(goalMonthlyNeed(goalRow({ dueOn: "2027-04-30" }), "2026-11-01")).toBe(500_000); // 6 months incl. this one
    expect(goalMonthlyNeed(goalRow({ dueOn: "2027-04-30", savedPaise: 600_000 }), "2026-11-01")).toBe(400_000);
    expect(goalMonthlyNeed(goalRow({ dueOn: "2026-11-15" }), "2026-11-01")).toBe(3_000_000); // due this month
    expect(goalMonthlyNeed(goalRow({ monthlyPaise: 250_000 }), "2026-11-01")).toBe(250_000);
    expect(goalMonthlyNeed(goalRow({ monthlyPaise: 250_000, savedPaise: 2_900_000 }), "2026-11-01")).toBe(100_000);
    expect(goalMonthlyNeed(goalRow({ savedPaise: 3_000_000, dueOn: "2027-01-01" }), "2026-11-01")).toBe(0);
    expect(goalMonthlyNeed(goalRow({}), "2026-11-01")).toBe(0); // open-ended
  });

  it("sets money aside and takes it back, never below zero", async () => {
    const g = await json<Goal>(api("/goals", { method: "POST", json: { name: "Insurance", targetPaise: 2_400_000, monthlyPaise: 200_000 } }));
    expect(g.monthlyNeedPaise).toBe(200_000);
    expect((await json<Goal>(api(`/goals/${g.id}/set-aside`, { method: "POST", json: { amountPaise: 500_000 } }))).savedPaise).toBe(500_000);
    expect((await json<Goal>(api(`/goals/${g.id}/set-aside`, { method: "POST", json: { amountPaise: -900_000 } }))).savedPaise).toBe(0);
    expect((await json<Goal>(api(`/goals/${g.id}`, { method: "PATCH", json: { archived: true } }))).archived).toBe(true);
    await api(`/goals/${g.id}`, { method: "DELETE" });
    expect(await json<Goal[]>(api("/goals"))).toEqual([]);
  });
});

describe("savings", () => {
  it("tracks this cycle against the target and the emergency fund, without the locked FD or set-asides", async () => {
    const { hdfc, idfc, indian, card, cash } = await seedAccounts();
    const today = istDate();
    for (const [id, bal] of [[hdfc.id, 1_546_776], [idfc.id, 261_000], [indian.id, 13_367]] as const) {
      await api(`/accounts/${id}/balance`, { method: "POST", json: { balancePaise: bal } });
    }
    await api(`/accounts/${card.id}`, { method: "PATCH", json: { fdLienPaise: 5_000_000 } });
    await api("/holdings", { method: "POST", json: { name: "IDFC FD", type: "fd", investedPaise: 5_000_000 } });
    await api("/cycles", { method: "POST", json: { startDate: today, plannedSpendPaise: 3_000_000 } });
    await api("/transactions", { method: "POST", json: { accountId: hdfc.id, amountPaise: 9_500_000, direction: "credit", kind: "income", incomeSource: "salary" } });
    await api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise: 50_000, direction: "debit", kind: "expense" } });
    await setSetting(db, "savings_target_paise", 2_000_000);
    const g = await json<Goal>(api("/goals", { method: "POST", json: { name: "Trip", targetPaise: 3_000_000, monthlyPaise: 300_000 } }));
    await api(`/goals/${g.id}/set-aside`, { method: "POST", json: { amountPaise: 100_000 } });

    const s = await json<Savings>(api("/savings"));
    expect(s.cycle).toMatchObject({ incomePaise: 9_500_000, spentPaise: 50_000, budgetPaise: 3_000_000, savedSoFarPaise: 9_450_000, projectedPaise: 6_500_000, targetPaise: 2_000_000 });
    // Bank + cash (cash went −₹500), the FD fully held as card collateral adds nothing, set-asides are spoken for.
    const liquid = 1_546_776 + 9_500_000 + 261_000 + 13_367 - 50_000 - 100_000;
    expect(s.emergency).toMatchObject({ liquidPaise: liquid, monthlySpendPaise: 3_000_000, basis: "budget", months: Math.round((liquid / 3_000_000) * 10) / 10 });
    expect(s).toMatchObject({ earmarkedPaise: 100_000, goalsMonthlyPaise: 300_000 });

    // Salary plan: no savings account, so the target and goal set-aside stay in the salary account.
    let plan = await json<SalaryPlan>(api("/salary-plan"));
    expect(plan).toMatchObject({ savingsTargetPaise: 2_000_000, goalsMonthlyPaise: 300_000 });
    expect(plan.items.some((i) => i.key === "savings")).toBe(false);

    // With a savings account it becomes a step that ticks off when the transfer arrives.
    const [savingsAcc] = await db.insert(schema.accounts).values({ name: "Savings", institution: "OTHER", kind: "bank", role: "other" }).returning();
    await api("/settings", { method: "PATCH", json: { savings_account_id: savingsAcc.id } });
    plan = await json<SalaryPlan>(api("/salary-plan"));
    expect(plan.savingsTargetPaise).toBe(0);
    expect(plan.items.find((i) => i.key === "savings")).toMatchObject({ needPaise: 2_000_000, done: false });
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: savingsAcc.id, amountPaise: 2_000_000 } });
    plan = await json<SalaryPlan>(api("/salary-plan"));
    expect(plan.items.find((i) => i.key === "savings")).toMatchObject({ sentPaise: 2_000_000, done: true });
  });
});
