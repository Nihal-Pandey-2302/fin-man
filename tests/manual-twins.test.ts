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
