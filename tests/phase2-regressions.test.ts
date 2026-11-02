// Regression tests for the Phase 2 code review (2026-11-01).
import { beforeEach, describe, expect, it } from "vitest";
import type { Txn } from "../shared/api";
import { addDays, istDate, istToUtc } from "../shared/time";
import { buildAlerts } from "../worker/ledger/alerts";
import { buildSalaryPlan } from "../worker/ledger/salary-plan";
import { setSetting } from "../worker/ledger/settings";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const iso = (date: string, h = 11) => {
  const [y, m, d] = date.split("-").map(Number);
  return istToUtc(y, m, d, h, 0).toISOString();
};
const txn = (body: Record<string, unknown>) => json<Txn>(api("/transactions", { method: "POST", json: body }));
beforeEach(resetLedger);

describe("phase 2 regressions", () => {
  it("salary plan ignores unrelated unpaired transfer legs", async () => {
    const { hdfc, idfc } = await seedAccounts();
    await api("/cycles", { method: "POST", json: { startDate: istDate(), plannedSpendPaise: 1_000_000 } });
    await txn({ accountId: hdfc.id, amountPaise: 1_000, direction: "debit", kind: "transfer" });
    await txn({ accountId: idfc.id, amountPaise: 77_700, direction: "credit", kind: "transfer" });
    const plan = await buildSalaryPlan(db);
    expect(plan.items.find((i) => i.key === "spending")?.sentPaise).toBe(0);
  });

  it("no 'short' alert for a credit card carrying an autopay", async () => {
    const { card } = await seedAccounts();
    await api("/autopays", { method: "POST", json: { name: "Spotify", kind: "subscription", accountId: card.id, amountPaise: 11_900, dayOfMonth: Number(addDays(istDate(), 2).slice(8)), nextDueOn: addDays(istDate(), 2) } });
    expect((await buildAlerts(db)).some((a) => a.key.startsWith("autopay_short"))).toBe(false);
  });

  it("overdue autopays raise an alert and count towards the shortfall", async () => {
    const { indian } = await seedAccounts();
    await api("/cycles", { method: "POST", json: { startDate: "2026-11-01", plannedSpendPaise: 1 } });
    await api("/autopays", { method: "POST", json: { name: "EMI", kind: "emi", accountId: indian.id, amountPaise: 500_000, dayOfMonth: 5, nextDueOn: "2026-11-05" } });
    const alerts = await buildAlerts(db, "2026-11-08");
    expect(alerts.find((a) => a.key.startsWith("autopay_overdue"))?.title).toBe("EMI not seen yet");
    expect(alerts.find((a) => a.key.startsWith("autopay_short"))?.title).toBe("Indian Bank is ₹5,000 short");
  });

  it("a transfer to yourself is never taken as an autopay", async () => {
    const { indian } = await seedAccounts();
    await setSetting(db, "owner_names", ["Test Owner"]);
    await api("/autopays", { method: "POST", json: { name: "SIP", kind: "sip", accountId: indian.id, amountPaise: 1_000_000, dayOfMonth: 10, nextDueOn: "2026-11-10" } });
    const t = await txn({ accountId: indian.id, amountPaise: 1_000_000, direction: "debit", kind: "expense", merchant: "TEST OWNER", occurredAt: iso("2026-11-10") });
    const row = (await db.select().from(schema.transactions).all()).find((r) => r.id === t.id);
    expect(row?.autopayId).toBeNull();
  });

  it("repeated bank heads-ups give one alert", async () => {
    await seedAccounts();
    const future = addDays(istDate(), 5);
    const [y, m, d] = future.split("-");
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
    const notice = fixture("indian/autopay_notice.txt").replace("07-Aug-26", `${d}-${mon}-${y.slice(2)}`);
    await postSms("VM-INDBNK", notice);
    await postSms("VM-INDBNK", notice.replace("Pause", "Kindly pause"));
    expect((await buildAlerts(db)).filter((a) => a.key.startsWith("untracked_autopay"))).toHaveLength(1);
  });

  it("deleting a matched debit moves the autopay back to unpaid", async () => {
    const { indian } = await seedAccounts();
    await api("/autopays", { method: "POST", json: { name: "Rent", kind: "bill", accountId: indian.id, amountPaise: 2_000_000, dayOfMonth: 5, nextDueOn: "2026-11-05" } });
    const t = await txn({ accountId: indian.id, amountPaise: 2_000_000, direction: "debit", kind: "expense", occurredAt: iso("2026-11-05") });
    expect((await db.select().from(schema.autopays).get())?.nextDueOn).toBe("2026-12-05");
    await api(`/transactions/${t.id}`, { method: "DELETE" });
    expect((await db.select().from(schema.autopays).get())?.nextDueOn).toBe("2026-11-05");
  });

  it("a second salary credit soon after payday adds income instead of a new cycle; un-marking undoes", async () => {
    const { hdfc } = await seedAccounts();
    await api("/cycles", { method: "POST", json: { startDate: "2026-10-01", plannedSpendPaise: 5 } });
    const first = await txn({ accountId: hdfc.id, amountPaise: 9_000_000, direction: "credit", kind: "income", incomeSource: "salary", occurredAt: iso("2026-10-31") });
    const bonus = await txn({ accountId: hdfc.id, amountPaise: 1_000_000, direction: "credit", kind: "income", incomeSource: "salary", occurredAt: iso("2026-11-03") });
    let cycles = await db.select().from(schema.budgetCycles).orderBy(schema.budgetCycles.startDate).all();
    expect(cycles.map((c) => [c.startDate, c.endDate, c.incomePaise])).toEqual([
      ["2026-10-01", "2026-10-30", 0],
      ["2026-10-31", null, 10_000_000],
    ]);
    expect(bonus.id).toBeGreaterThan(first.id);

    await api(`/transactions/${first.id}`, { method: "PATCH", json: { incomeSource: "other" } });
    cycles = await db.select().from(schema.budgetCycles).orderBy(schema.budgetCycles.startDate).all();
    expect(cycles.map((c) => [c.startDate, c.endDate])).toEqual([["2026-10-01", null]]);
  });
});
