import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Occurrence, Report, SalaryPlan, Txn } from "../shared/api";
import { addDays, istDate, istToUtc } from "../shared/time";
import { buildAlerts } from "../worker/ledger/alerts";
import { autopayCalendar } from "../worker/ledger/autopays";
import { buildReport } from "../worker/ledger/report";
import { buildSalaryPlan } from "../worker/ledger/salary-plan";
import { setSetting } from "../worker/ledger/settings";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const iso = (date: string, h = 11) => {
  const [y, m, d] = date.split("-").map(Number);
  return istToUtc(y, m, d, h, 0).toISOString();
};
const txn = (body: Record<string, unknown>) => json<Txn>(api("/transactions", { method: "POST", json: body }));
const cycles = () => db.select().from(schema.budgetCycles).orderBy(schema.budgetCycles.startDate).all();

beforeEach(resetLedger);

describe("salary detection", () => {
  it("auto-detects a large employer credit to the salary account in the 28th–7th window and starts a cycle", async () => {
    const { hdfc } = await seedAccounts();
    await setSetting(db, "salary_min_paise", 5_000_000);
    await setSetting(db, "salary_employer", "acme");
    await api("/cycles", { method: "POST", json: { startDate: "2026-09-01", plannedSpendPaise: 2_500_000 } });

    const t = await txn({ accountId: hdfc.id, amountPaise: 9_000_000, direction: "credit", kind: "income", merchant: "ACME TECH PVT LTD NEFT", occurredAt: iso("2026-10-01") });
    const after = await db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id)).get();
    const salary = await db.select().from(schema.categories).where(eq(schema.categories.name, "Salary")).get();
    expect(after).toMatchObject({ incomeSource: "salary", categoryId: salary!.id, status: "confirmed" });
    expect((await cycles()).map((c) => [c.startDate, c.endDate, c.plannedSpendPaise, c.incomePaise, c.salaryTxnId])).toEqual([
      ["2026-09-01", "2026-09-30", 2_500_000, 0, null],
      ["2026-10-01", null, 2_500_000, 9_000_000, t.id],
    ]);
  });

  it("ignores credits outside the window, below the threshold or from someone else", async () => {
    const { hdfc } = await seedAccounts();
    await setSetting(db, "salary_min_paise", 5_000_000);
    await setSetting(db, "salary_employer", "acme");
    await txn({ accountId: hdfc.id, amountPaise: 9_000_000, direction: "credit", kind: "income", merchant: "ACME", occurredAt: iso("2026-10-15") });
    await txn({ accountId: hdfc.id, amountPaise: 100_000, direction: "credit", kind: "income", merchant: "ACME", occurredAt: iso("2026-10-01") });
    await txn({ accountId: hdfc.id, amountPaise: 9_000_000, direction: "credit", kind: "income", merchant: "DAD", occurredAt: iso("2026-10-02") });
    expect(await cycles()).toHaveLength(0);
  });

  it("marking a credit as salary starts the cycle (no settings needed)", async () => {
    const { hdfc } = await seedAccounts();
    const t = await txn({ accountId: hdfc.id, amountPaise: 9_000_000, direction: "credit", kind: "income", occurredAt: iso("2026-10-31") });
    expect(await cycles()).toHaveLength(0);
    await api(`/transactions/${t.id}`, { method: "PATCH", json: { incomeSource: "salary" } });
    expect((await cycles()).map((c) => [c.startDate, c.salaryTxnId])).toEqual([["2026-10-31", t.id]]);
    const salary = await db.select().from(schema.categories).where(eq(schema.categories.name, "Salary")).get();
    expect(await db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id)).get()).toMatchObject({ categoryId: salary!.id, status: "confirmed" });
  });

  it("re-anchors a cycle the owner started by hand a few days before payday", async () => {
    const { hdfc } = await seedAccounts();
    await api("/cycles", { method: "POST", json: { startDate: "2026-10-29", plannedSpendPaise: 3_000_000 } });
    const t = await txn({ accountId: hdfc.id, amountPaise: 9_000_000, direction: "credit", kind: "income", incomeSource: "salary", occurredAt: iso("2026-11-01") });
    expect((await cycles()).map((c) => [c.startDate, c.salaryTxnId, c.incomePaise])).toEqual([["2026-10-29", t.id, 9_000_000]]);
  });
});

describe("autopays", () => {
  it("matches the debit to its autopay, marks it paid and moves the due date", async () => {
    const { indian } = await seedAccounts();
    const emi = await json<{ id: number }>(
      api("/autopays", { method: "POST", json: { name: "Zenith Auto Rentals", kind: "emi", accountId: indian.id, amountPaise: 612_000, dayOfMonth: 7, nextDueOn: "2026-11-07" } }),
    );
    const sip = await json<{ id: number }>(
      api("/autopays", { method: "POST", json: { name: "Flexi Cap SIP", kind: "sip", accountId: indian.id, amountPaise: 500_000, dayOfMonth: 10, nextDueOn: "2026-11-10" } }),
    );
    const paid = await txn({ accountId: indian.id, amountPaise: 612_000, direction: "debit", kind: "expense", merchant: "NACH ZENITH AUTO", occurredAt: iso("2026-11-08") });
    const sipDebit = await txn({ accountId: indian.id, amountPaise: 500_000, direction: "debit", kind: "expense", occurredAt: iso("2026-11-10") });

    const rows = await db.select().from(schema.transactions).all();
    expect(rows.find((r) => r.id === paid.id)).toMatchObject({ autopayId: emi.id, kind: "expense", status: "confirmed" });
    expect(rows.find((r) => r.id === sipDebit.id)).toMatchObject({ autopayId: sip.id, kind: "investment" });
    const ap = await db.select().from(schema.autopays).all();
    expect(ap.map((a) => a.nextDueOn)).toEqual(["2026-12-07", "2026-12-10"]);

    const cal = await autopayCalendar(db, "2026-11-01", "2026-12-31", "2026-11-20");
    expect(cal.map((o: Occurrence) => [o.name, o.dueOn, o.status, o.transactionId])).toEqual([
      ["Zenith Auto Rentals", "2026-11-07", "paid", paid.id],
      ["Flexi Cap SIP", "2026-11-10", "paid", sipDebit.id],
      ["Zenith Auto Rentals", "2026-12-07", "due", null],
      ["Flexi Cap SIP", "2026-12-10", "due", null],
    ]);
  });

  it("doesn't match a debit with the wrong amount and no name, or far from the due date", async () => {
    const { indian } = await seedAccounts();
    await api("/autopays", { method: "POST", json: { name: "Netflix", kind: "subscription", accountId: indian.id, amountPaise: 64_900, dayOfMonth: 15, nextDueOn: "2026-11-15" } });
    const a = await txn({ accountId: indian.id, amountPaise: 99_900, direction: "debit", kind: "expense", occurredAt: iso("2026-11-15") });
    const b = await txn({ accountId: indian.id, amountPaise: 64_900, direction: "debit", kind: "expense", occurredAt: iso("2026-11-01") });
    const rows = await db.select().from(schema.transactions).all();
    expect(rows.filter((r) => [a.id, b.id].includes(r.id)).every((r) => r.autopayId === null)).toBe(true);
  });

  it("a bank heads-up SMS confirms the due date, and untracked ones raise an alert", async () => {
    const { indian } = await seedAccounts();
    const future = addDays(istDate(), 6);
    const [y, m, d] = future.split("-");
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
    const notice = fixture("indian/autopay_notice.txt").replace("07-Aug-26", `${d}-${mon}-${y.slice(2)}`);

    let alerts = await buildAlerts(db);
    expect(alerts.some((a) => a.key.startsWith("untracked_autopay"))).toBe(false);
    await postSms("VM-INDBNK", notice);
    alerts = await buildAlerts(db);
    expect(alerts.find((a) => a.key.startsWith("untracked_autopay"))?.title).toContain("Zenith Auto Rentals");

    await api("/autopays", { method: "POST", json: { name: "Zenith Auto", kind: "emi", accountId: indian.id, amountPaise: 612_000, dayOfMonth: Number(addDays(future, -2).slice(8)), nextDueOn: addDays(future, -2) } });
    await postSms("VM-INDBNK", notice.replace("Pause", "Kindly pause")); // a second heads-up (new hash)
    const [ap] = await db.select().from(schema.autopays).all();
    expect(ap.nextDueOn).toBe(future);
    expect((await buildAlerts(db)).some((a) => a.key.startsWith("untracked_autopay"))).toBe(false);
  });
});

describe("alerts", () => {
  it("warns about a card bill due soon and an autopay account that's short", async () => {
    const { indian, card } = await seedAccounts();
    const today = "2026-11-03";
    await db.update(schema.accounts).set({ dueDay: 5 }).where(eq(schema.accounts.id, card.id));
    await postSms("JD-IDFCFB", fixture("card/spend_rupay_swiggy.txt"));
    await api(`/accounts/${indian.id}/balance`, { method: "POST", json: { balancePaise: 100_000 } });
    await api("/autopays", { method: "POST", json: { name: "EMI", kind: "emi", accountId: indian.id, amountPaise: 612_000, dayOfMonth: 4, nextDueOn: "2026-11-04" } });

    const alerts = await buildAlerts(db, today);
    expect(alerts.find((a) => a.key.startsWith("card_due"))).toMatchObject({ level: "warn", title: "IDFC Credit Card bill due in 2 days" });
    expect(alerts.find((a) => a.key.startsWith("autopay_short"))?.title).toBe("Indian Bank is ₹5,120 short");
    expect(alerts.find((a) => a.key.startsWith("autopay_tomorrow"))?.body).toContain("EMI");
  });

  it("nags about missing salary only once salary is known", async () => {
    await seedAccounts();
    expect((await buildAlerts(db, "2026-11-06")).some((a) => a.key.startsWith("salary_missing"))).toBe(false);
    await setSetting(db, "salary_min_paise", 1);
    expect((await buildAlerts(db, "2026-11-06")).some((a) => a.key.startsWith("salary_missing"))).toBe(true);
    expect((await buildAlerts(db, "2026-11-03")).some((a) => a.key.startsWith("salary_missing"))).toBe(false);
  });
});

describe("salary-day plan", () => {
  it("plans card bill, spending top-up and autopay top-up, and ticks them off as transfers arrive", async () => {
    const { hdfc, idfc, indian, card } = await seedAccounts();
    const today = istDate();
    await api("/cycles", { method: "POST", json: { startDate: today, plannedSpendPaise: 3_000_000 } });
    await api(`/accounts/${hdfc.id}/balance`, { method: "POST", json: { balancePaise: 10_000_000 } });
    await api(`/accounts/${idfc.id}/balance`, { method: "POST", json: { balancePaise: 500_000 } });
    await api(`/accounts/${indian.id}/balance`, { method: "POST", json: { balancePaise: 200_000 } });
    await api(`/accounts/${card.id}/balance`, { method: "POST", json: { balancePaise: 1_200_000 } });
    await api("/autopays", { method: "POST", json: { name: "EMI", kind: "emi", accountId: indian.id, amountPaise: 600_000, dayOfMonth: Number(addDays(today, 5).slice(8)), nextDueOn: addDays(today, 5) } });
    await setSetting(db, "autopay_buffer_paise", 100_000);

    let plan: SalaryPlan = await buildSalaryPlan(db, today);
    expect(plan.items.map((i) => [i.key, i.needPaise, i.done])).toEqual([
      ["card_bill", 1_200_000, false],
      ["spending", 3_000_000 - 600_000 - 500_000, false],
      ["autopays", 600_000 + 100_000 - 200_000, false],
    ]);
    expect(plan.keepPaise).toBe(10_000_000 - 1_200_000 - 1_900_000 - 500_000);

    for (const [to, amount] of [[card.id, 1_200_000], [idfc.id, 1_900_000], [indian.id, 500_000]] as const) {
      await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: to, amountPaise: amount } });
    }
    plan = await json<SalaryPlan>(api("/salary-plan"));
    expect(plan.items.every((i) => i.done)).toBe(true);
    expect(plan.items.map((i) => i.sentPaise)).toEqual([1_200_000, 1_900_000, 500_000]);
  });
});

describe("report", () => {
  it("summarises spend by category and merchant against the previous cycle", async () => {
    const { idfc, card } = await seedAccounts();
    const food = (await db.select().from(schema.categories).where(eq(schema.categories.name, "Food & dining")).get())!;
    await api("/cycles", { method: "POST", json: { startDate: "2026-09-01", plannedSpendPaise: 1 } });
    await api("/cycles", { method: "POST", json: { startDate: "2026-10-01", plannedSpendPaise: 1 } });
    await txn({ accountId: card.id, amountPaise: 30_000, direction: "debit", kind: "expense", categoryId: food.id, merchant: "Swiggy", occurredAt: iso("2026-09-10") });
    await txn({ accountId: card.id, amountPaise: 40_000, direction: "debit", kind: "expense", categoryId: food.id, merchant: "Swiggy", occurredAt: iso("2026-10-05") });
    await txn({ accountId: card.id, amountPaise: 20_000, direction: "debit", kind: "expense", categoryId: food.id, merchant: "SWIGGY", occurredAt: iso("2026-10-06") });
    await txn({ accountId: idfc.id, amountPaise: 99_000, direction: "debit", kind: "investment", merchant: "Groww", occurredAt: iso("2026-10-07") });

    const r: Report = await buildReport(db, "2026-10-01", "2026-10-20");
    expect(r).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-31", spendPaise: 60_000, investedPaise: 99_000, daysElapsed: 20 });
    expect(r.previous).toMatchObject({ startDate: "2026-09-01", spendPaise: 30_000 });
    expect(r.byCategory).toEqual([{ categoryId: food.id, spendPaise: 60_000, previousPaise: 30_000 }]);
    expect(r.topMerchants).toEqual([{ merchant: "SWIGGY", spendPaise: 60_000, count: 2 }]);
    expect(r.biggest.map((t) => t.amountPaise)).toEqual([40_000, 20_000]);
  });
});

