// Hand-entered money (salary, salary-plan transfers) and the bank SMS that arrives for it later must be one transaction.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Txn } from "../shared/api";
import { istToUtc } from "../shared/time";
import { buildDashboard } from "../worker/ledger/dashboard";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const ist = (y: number, m: number, d: number, h = 10) => istToUtc(y, m, d, h, 0);
const allTxns = () => db.select().from(schema.transactions).all();
const salary = (accountId: number, amountPaise: number, at: Date) =>
  json<Txn>(api("/transactions", { method: "POST", json: { accountId, amountPaise, direction: "credit", kind: "income", incomeSource: "salary", occurredAt: at.toISOString() } }));
beforeEach(resetLedger);

describe("manual entry + its SMS", () => {
  it("a salary recorded by hand absorbs the bank's credit SMS", async () => {
    const { hdfc } = await seedAccounts();
    const manual = await salary(hdfc.id, 100_000, ist(2026, 10, 30, 9));
    const cycle = await db.select().from(schema.budgetCycles).where(eq(schema.budgetCycles.salaryTxnId, manual.id)).get();
    expect(cycle?.startDate).toBe("2026-10-30");

    const out = await json<{ status: string; reason?: string; transactionId?: number }>(postSms("AD-HDFCBK-S", fixture("hdfc/upi_credit.txt"), +ist(2026, 10, 30, 11)));
    expect(out).toMatchObject({ status: "duplicate", reason: "linked_manual", transactionId: manual.id });

    const txns = await allTxns();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ id: manual.id, source: "sms", incomeSource: "salary", counterpartyVpa: "*llet@phonepe" });
    expect(txns[0].smsId).not.toBeNull();
    // Still the same cycle: the link didn't move the salary to another day.
    expect((await db.select().from(schema.budgetCycles).all()).map((c) => c.salaryTxnId)).toEqual([manual.id]);
  });

  it("a salary-plan transfer recorded by hand absorbs the receiving bank's SMS and takes its balance", async () => {
    const { hdfc, idfc } = await seedAccounts();
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: idfc.id, amountPaise: 200_000, occurredAt: ist(2026, 10, 31, 9).toISOString() } });
    const out = await json<{ status: string; reason?: string }>(postSms("JD-IDFCFB-S", fixture("idfc/credit.txt"), +ist(2026, 10, 31, 10)));
    expect(out.reason).toBe("linked_manual");

    const txns = await allTxns();
    expect(txns).toHaveLength(2);
    const credit = txns.find((t) => t.accountId === idfc.id)!;
    expect(credit).toMatchObject({ kind: "transfer", balanceAfterPaise: 336_000 });
    expect(credit.transferGroupId).toBe(txns.find((t) => t.accountId === hdfc.id)!.transferGroupId);
    // The SMS's exact time replaces the hand-entered one on the same day.
    expect(+credit.occurredAt).toBe(+istToUtc(2026, 10, 31, 9, 59));
  });

  it("leaves unrelated manual entries alone", async () => {
    const { hdfc } = await seedAccounts();
    await salary(hdfc.id, 100_100, ist(2026, 10, 30)); // different amount
    await salary(hdfc.id, 100_000, ist(2026, 10, 26)); // too early (4 days before)
    const out = await json<{ status: string }>(postSms("AD-HDFCBK-S", fixture("hdfc/upi_credit.txt"), +ist(2026, 10, 30, 11)));
    expect(out.status).toBe("created");
    expect(await allTxns()).toHaveLength(3);
  });

  it("one manual entry absorbs only one SMS", async () => {
    const { idfc, hdfc } = await seedAccounts();
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: idfc.id, amountPaise: 200_000, occurredAt: ist(2026, 10, 31, 9).toISOString() } });
    await postSms("JD-IDFCFB-S", fixture("idfc/credit.txt"), +ist(2026, 10, 31, 10));
    // A second, different credit SMS for the same amount is real new money.
    const second = fixture("idfc/credit.txt").replace("09:59", "18:30").replace("3,360.00", "5,360.00");
    expect((await json<{ status: string }>(postSms("JD-IDFCFB-S", second, +ist(2026, 10, 31, 19)))).status).toBe("created");
    expect(await allTxns()).toHaveLength(3);
  });

  it("creating a transaction from an unread SMS links to the manual entry", async () => {
    const { hdfc } = await seedAccounts();
    const manual = await salary(hdfc.id, 9_500_000, ist(2026, 10, 28, 9));
    const unread = await json<{ smsId: number; status: string }>(postSms("AD-HDFCBK-S", "SYNTHETIC unrecognised message (not a real bank format): HDFC Bank salary 95000", +ist(2026, 10, 28, 10)));
    expect(unread.status).toBe("unparsed");
    const res = await api("/transactions", { method: "POST", json: { smsId: unread.smsId, accountId: hdfc.id, amountPaise: 9_500_000, direction: "credit", kind: "income" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: manual.id, linked: true });
    expect(await allTxns()).toHaveLength(1);
  });
});

describe("dashboard salary prompt", () => {
  it("asks around payday until a salary is recorded", async () => {
    const { hdfc } = await seedAccounts();
    expect((await buildDashboard(db, ist(2026, 11, 15))).salary.awaiting).toBe(false);
    const before = await buildDashboard(db, ist(2026, 11, 28));
    expect(before.salary).toEqual({ awaiting: true, lastPaise: null, lastAccountId: null });
    await salary(hdfc.id, 9_500_000, ist(2026, 11, 28, 9));
    expect((await buildDashboard(db, ist(2026, 11, 29))).salary).toEqual({ awaiting: false, lastPaise: 9_500_000, lastAccountId: hdfc.id });
    // Next month it asks again, prefilled from this one.
    expect((await buildDashboard(db, ist(2026, 12, 29))).salary.awaiting).toBe(true);
  });
});

describe("recording by hand after the SMS", () => {
  it("salary-plan Record reuses the bank debit for a card bill the card never texted about", async () => {
    const { hdfc, card } = await seedAccounts();
    const bill = fixture("hdfc/upi_debit.txt").replace("HDFC SECURITIES LTD", "IDFC FIRST BANK CREDIT CARD");
    const sms = await json<{ transactionId: number }>(postSms("AD-HDFCBK-S", bill, +ist(2026, 10, 27, 20)));
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: card.id, amountPaise: 52_000, occurredAt: ist(2026, 10, 27, 21).toISOString() } });

    const txns = await allTxns();
    expect(txns).toHaveLength(2);
    const debit = txns.find((t) => t.id === sms.transactionId)!;
    const credit = txns.find((t) => t.accountId === card.id)!;
    expect(debit).toMatchObject({ kind: "card_payment", status: "confirmed", categoryId: null });
    expect(credit).toMatchObject({ kind: "card_payment", direction: "credit", source: "manual", transferGroupId: debit.transferGroupId });
    // Not spending.
    const d = await buildDashboard(db, ist(2026, 10, 28));
    expect(d.daily.reduce((s, x) => s + x.spentPaise, 0)).toBe(0);
  });
});

describe("autopay marked paid by hand", () => {
  const autopay = (accountId: number, amountPaise: number, nextDueOn: string, kind = "emi") =>
    json<{ id: number }>(api("/autopays", { method: "POST", json: { name: "Car rental EMI", kind, accountId, amountPaise, dayOfMonth: Number(nextDueOn.slice(8)), nextDueOn } }));

  it("records the debit on its due day, links it, and undoes cleanly", async () => {
    const { indian } = await seedAccounts();
    const a = await autopay(indian.id, 612_000, "2026-10-30");
    const r = await json<{ nextDueOn: string; transactionId: number; linked: boolean }>(api(`/autopays/${a.id}/paid`, { method: "POST", json: {} }));
    expect(r).toMatchObject({ nextDueOn: "2026-11-30", linked: false });

    const [t] = await allTxns();
    expect(t).toMatchObject({ id: r.transactionId, accountId: indian.id, amountPaise: 612_000, direction: "debit", kind: "expense", autopayId: a.id, transferGroupId: null });
    expect(+t.occurredAt).toBe(+ist(2026, 10, 30));

    await api(`/transactions/${t.id}`, { method: "DELETE" });
    expect((await db.select().from(schema.autopays).where(eq(schema.autopays.id, a.id)).get())?.nextDueOn).toBe("2026-10-30");
  });

  it("links a debit that already came in by SMS instead of adding another", async () => {
    const { indian } = await seedAccounts();
    const sms = await json<{ transactionId: number }>(postSms("AD-INDBNK-S", fixture("indian/upi_debit.txt"), +ist(2026, 8, 1, 12)));
    // Due a week after the debit: too far for the automatic match, so it stayed a plain expense.
    const a = await autopay(indian.id, 157_800, "2026-08-08");
    expect((await allTxns())[0].autopayId).toBeNull();
    const r = await json<{ linked: boolean; transactionId: number }>(api(`/autopays/${a.id}/paid`, { method: "POST", json: { paidOn: "2026-08-01" } }));
    expect(r).toMatchObject({ linked: true, transactionId: sms.transactionId });
    const txns = await allTxns();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ autopayId: a.id, status: "confirmed" });
  });

  it("a SIP marked paid is an investment, not spending", async () => {
    const { indian } = await seedAccounts();
    const a = await autopay(indian.id, 500_000, "2026-10-10", "sip");
    await api(`/autopays/${a.id}/paid`, { method: "POST", json: {} });
    expect((await allTxns())[0].kind).toBe("investment");
  });
});
