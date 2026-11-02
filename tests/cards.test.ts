// Card bill guard: what the last statement asks for, what's been paid, and the alerts around it.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { istToUtc } from "../shared/time";
import { buildAlerts } from "../worker/ledger/alerts";
import { computeBalances } from "../worker/ledger/balances";
import { cardStatuses, dueDateFor, lastStatementDate } from "../worker/ledger/cards";
import { buildSalaryPlan } from "../worker/ledger/salary-plan";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const ist = (y: number, m: number, d: number, h = 10) => istToUtc(y, m, d, h, 0);
async function statusOn(today: string) {
  const rows = await db.select().from(schema.accounts).all();
  return (await cardStatuses(db, rows, await computeBalances(db, rows, today), today))[0];
}
const setCard = (id: number, values: Partial<typeof schema.accounts.$inferInsert>) => db.update(schema.accounts).set(values).where(eq(schema.accounts.id, id));
beforeEach(resetLedger);

describe("statement dates", () => {
  it("finds the last statement and its due date, clamping short months", () => {
    expect(lastStatementDate("2026-11-01", 20)).toBe("2026-10-20");
    expect(lastStatementDate("2026-11-20", 20)).toBe("2026-11-20");
    expect(dueDateFor("2026-10-20", 4)).toBe("2026-11-04");
    expect(dueDateFor("2026-10-02", 20)).toBe("2026-10-20");
    expect(lastStatementDate("2027-02-28", 31)).toBe("2027-02-28");
    expect(lastStatementDate("2027-03-15", 31)).toBe("2027-02-28");
  });
});

describe("card bill guard", () => {
  it("balance entered after the statement: unknown until the owner enters it, then due, then paid", async () => {
    const { hdfc, card } = await seedAccounts();
    await setCard(card.id, { creditLimitPaise: 5_000_000, statementDay: 20, dueDay: 4, openingBalancePaise: 2_728_914, openingBalanceAt: ist(2026, 11, 1, 13) });
    const today = "2026-11-01";

    let s = await statusOn(today);
    expect(s).toMatchObject({ statementDate: "2026-10-20", dueDate: "2026-11-04", status: "unknown", statementPaise: null, outstandingPaise: 2_728_914, daysToDue: 3 });
    let alerts = await buildAlerts(db, today);
    expect(alerts.find((a) => a.key.startsWith("card_due"))?.body).toContain("Enter the statement amount");
    const util = alerts.find((a) => a.key.startsWith("card_util"))!;
    expect(util).toMatchObject({ level: "warn", title: "IDFC Credit Card at 55% of its limit", quiet: true });

    expect((await api(`/cards/${hdfc.id}/statement`, { method: "PUT", json: { statementDate: "2026-10-20", amountPaise: 1 } })).status).toBe(404);
    await api(`/cards/${card.id}/statement`, { method: "PUT", json: { statementDate: "2026-10-20", amountPaise: 2_000_000, minDuePaise: 100_000 } });
    s = await statusOn(today);
    expect(s).toMatchObject({ status: "due", statementPaise: 2_000_000, statementSource: "bank", minDuePaise: 100_000, leftToPayPaise: 2_000_000 });
    alerts = await buildAlerts(db, today);
    expect(alerts.find((a) => a.key.startsWith("card_due"))).toMatchObject({ level: "warn", title: "Pay ₹20,000 on IDFC Credit Card in 3 days" });
    expect((await buildSalaryPlan(db, today)).items.find((i) => i.key === "card_bill")?.needPaise).toBe(2_000_000);

    // Unpaid past the due date: overdue.
    expect((await statusOn("2026-11-06")).status).toBe("overdue");
    expect((await buildAlerts(db, "2026-11-06")).find((a) => a.key.startsWith("card_overdue"))?.level).toBe("danger");

    // Paid in part, then in full.
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: card.id, amountPaise: 500_000, occurredAt: ist(2026, 11, 1, 14).toISOString() } });
    expect(await statusOn(today)).toMatchObject({ status: "due", paidPaise: 500_000, leftToPayPaise: 1_500_000 });
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: card.id, amountPaise: 1_500_000, occurredAt: ist(2026, 11, 1, 15).toISOString() } });
    expect(await statusOn("2026-11-06")).toMatchObject({ status: "paid", leftToPayPaise: 0 });
    alerts = await buildAlerts(db, "2026-11-06");
    expect(alerts.some((a) => a.key.startsWith("card_due") || a.key.startsWith("card_overdue"))).toBe(false);
  });

  it("works the statement out from card SMS when the ledger reaches back far enough", async () => {
    const { hdfc, card } = await seedAccounts(); // limit ₹25,000
    await setCard(card.id, { statementDay: 30, dueDay: 15, openingBalancePaise: 100_000, openingBalanceAt: ist(2026, 10, 25) });
    // On statement day (30 Oct, avail ₹23,800.86) and the day after (31 Oct, ₹380 at Swiggy).
    await postSms("JD-IDFCFB-S", fixture("card/spend_rupay_pitstop.txt"), +ist(2026, 10, 30, 16));
    await postSms("JD-IDFCFB-S", fixture("card/spend_rupay_swiggy.txt"), +ist(2026, 10, 31, 21));
    const s = await statusOn("2026-11-05");
    expect(s).toMatchObject({
      statementDate: "2026-10-30",
      dueDate: "2026-11-15",
      statementSource: "computed",
      statementPaise: 2_500_000 - 2_380_086,
      spentSincePaise: 38_000,
      status: "due",
      daysToDue: 10,
    });
    // Ten days out: no due alert yet.
    expect((await buildAlerts(db, "2026-11-05")).some((a) => a.key.startsWith("card_due"))).toBe(false);
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: card.id, amountPaise: 2_500_000 - 2_380_086, occurredAt: ist(2026, 11, 5).toISOString() } });
    expect((await statusOn("2026-11-05")).status).toBe("paid");
  });

  it("a card without a statement day keeps the plain due-date reminder", async () => {
    const { card } = await seedAccounts();
    await setCard(card.id, { dueDay: 5 });
    await postSms("JD-IDFCFB", fixture("card/spend_rupay_swiggy.txt"));
    expect((await statusOn("2026-11-03")).status).toBe("unknown");
  });
});

describe("credit-history nudge before the statement", () => {
  it("asks to pay down to ~10% of the limit on the two days before the statement", async () => {
    const { card } = await seedAccounts();
    await setCard(card.id, { creditLimitPaise: 5_000_000, statementDay: 20, dueDay: 4, openingBalancePaise: 2_000_000, openingBalanceAt: ist(2026, 11, 10) });
    const nudge = async (today: string) => (await buildAlerts(db, today)).find((a) => a.key.startsWith("card_prestatement"));
    expect(await nudge("2026-11-17")).toBeUndefined();
    expect(await nudge("2026-11-18")).toMatchObject({ level: "warn", title: "Pay ₹15,000 on IDFC Credit Card before 20 Nov" });
    expect((await nudge("2026-11-19"))?.body).toContain("40% of the limit");
    expect(await nudge("2026-11-20")).toBeUndefined(); // statement day itself: too late
    // Already low: nothing to say.
    await setCard(card.id, { openingBalancePaise: 400_000 });
    expect(await nudge("2026-11-18")).toBeUndefined();
  });
});
