// Real-life situations, replayed with made-up names and amounts: rent paid from whichever account had money,
// a few hours' loan from a friend, salary landing in another bank, a card bill whose payee a rule had filed,
// a mis-set forwarder.
import { eq } from "drizzle-orm";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Txn } from "../shared/api";
import { istToUtc } from "../shared/time";
import { buildAlerts } from "../worker/ledger/alerts";
import { cycleMoney } from "../worker/ledger/budget";
import { buildDashboard } from "../worker/ledger/dashboard";
import { looksLikePerson } from "../worker/ledger/loans";
import { setSetting } from "../worker/ledger/settings";
import { normalizeBody, smsHash } from "../worker/sms/normalize";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const at = (d: number, h = 12, min = 0) => istToUtc(2026, 11, d, h, min);
const cat = async (name: string) => (await db.select().from(schema.categories).where(eq(schema.categories.name, name)).get())!.id;
const txn = async (id: number) => (await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get())!;
const add = (body: Record<string, unknown>) => json<Txn>(api("/transactions", { method: "POST", json: body }));
const CYCLE = { startDate: "2026-11-01", endDate: "2026-11-30", budgetPaise: 6_700_000 };
beforeEach(async () => {
  await resetLedger();
  await db.delete(schema.settings);
});

describe("fixed costs and the daily limit", () => {
  it("rent is set aside up front, counts from any account in any split, and paying it never moves the daily number", async () => {
    const { idfc, indian } = await seedAccounts();
    const rent = await cat("Rent");
    await setSetting(db, "fixed_costs", [{ name: "Rent", categoryId: rent, amountPaise: 2_600_000 }]);
    const before = await cycleMoney(db, CYCLE, "2026-11-04");
    expect(before).toMatchObject({ fixedDuePaise: 2_600_000, spentPaise: 0, remainingPaise: 6_700_000 - 2_600_000 });

    // ₹25,000 from Indian Bank and ₹1,000 from IDFC, both filed under Rent.
    await add({ accountId: indian.id, amountPaise: 2_500_000, direction: "debit", kind: "expense", categoryId: rent, occurredAt: at(4, 16).toISOString() });
    await add({ accountId: idfc.id, amountPaise: 100_000, direction: "debit", kind: "expense", categoryId: rent, occurredAt: at(4, 16, 5).toISOString() });
    const paid = await cycleMoney(db, CYCLE, "2026-11-04");
    expect(paid.fixed).toEqual([{ name: "Rent", categoryId: rent, amountPaise: 2_600_000, paidPaise: 2_600_000 }]);
    expect(paid.fixedDuePaise).toBe(0);
    expect(paid.dailyAllowancePaise).toBe(before.dailyAllowancePaise);
    expect(paid.spentTodayPaise).toBe(0); // rent isn't day-to-day spending
    expect(paid.daily).toEqual([]);

    // Paying more than planned does come out of day-to-day money.
    await add({ accountId: idfc.id, amountPaise: 230_000, direction: "debit", kind: "expense", categoryId: rent, occurredAt: at(4, 17).toISOString() });
    expect((await cycleMoney(db, CYCLE, "2026-11-04")).remainingPaise).toBe(before.remainingPaise - 230_000);
  });

  it("an autopay past its date is still set aside until it's actually paid", async () => {
    const { indian } = await seedAccounts();
    await api("/autopays", { method: "POST", json: { name: "Scooty rent", kind: "bill", accountId: indian.id, amountPaise: 578_100, dayOfMonth: 7, nextDueOn: "2026-11-07" } });
    expect((await cycleMoney(db, CYCLE, "2026-11-09")).autopaysDuePaise).toBe(578_100);
  });
});

describe("short loans from friends", () => {
  it("money from a person and back to them within days is a loan and its repayment, not income and spending", async () => {
    const { hdfc, indian } = await seedAccounts();
    const lent = await add({ accountId: indian.id, amountPaise: 2_450_000, direction: "credit", kind: "income", merchant: "Arjun Mehra", occurredAt: at(4, 16, 32).toISOString() });
    const back = await add({ accountId: hdfc.id, amountPaise: 2_440_000, direction: "debit", kind: "expense", merchant: "ARJUN MEHRA", occurredAt: at(4, 19, 19).toISOString() });

    const [loan] = await db.select().from(schema.loans).all();
    expect(loan).toMatchObject({ person: "Arjun Mehra", direction: "you_owe", principalPaise: 2_450_000, txnId: lent.id, status: "partially_paid" });
    expect(await txn(lent.id)).toMatchObject({ kind: "transfer", loanId: loan.id, status: "needs_review" });
    expect(await txn(back.id)).toMatchObject({ kind: "transfer", loanId: loan.id, status: "needs_review" });
    expect((await cycleMoney(db, CYCLE, "2026-11-04")).spentPaise).toBe(0);

    // The last ₹100 went from an account the app doesn't track: record it by hand.
    await api(`/loans/${loan.id}/payments`, { method: "POST", json: { amountPaise: 10_000, paidOn: "2026-11-04", note: "from another account" } });
    expect((await db.select().from(schema.loans).get())!.status).toBe("settled");

    // "Not a loan" puts it all back as money in and out.
    await api(`/loans/${loan.id}/unwind`, { method: "POST" });
    expect(await db.select().from(schema.loans).all()).toEqual([]);
    expect(await txn(lent.id)).toMatchObject({ kind: "income", loanId: null });
    expect(await txn(back.id)).toMatchObject({ kind: "expense", loanId: null });
  });

  it("leaves shops, small amounts and different amounts alone", async () => {
    const { idfc } = await seedAccounts();
    expect(looksLikePerson("ARJUN MEHRA", [])).toBe(true);
    expect(looksLikePerson("SWIGGY", [])).toBe(false);
    expect(looksLikePerson("BLINKIT COMMERCE PRIVATE LIMITED", [])).toBe(false);
    // A refund from a shop: debit, then the same back. Money out first is never guessed as a loan.
    await add({ accountId: idfc.id, amountPaise: 90_000, direction: "debit", kind: "expense", merchant: "Croma Retail", occurredAt: at(3).toISOString() });
    await add({ accountId: idfc.id, amountPaise: 90_000, direction: "credit", kind: "income", merchant: "Croma Retail", occurredAt: at(4).toISOString() });
    // Too small to be a loan, and too different.
    await add({ accountId: idfc.id, amountPaise: 20_000, direction: "credit", kind: "income", merchant: "Priya Sharma", occurredAt: at(3).toISOString() });
    await add({ accountId: idfc.id, amountPaise: 20_000, direction: "debit", kind: "expense", merchant: "Priya Sharma", occurredAt: at(4).toISOString() });
    await add({ accountId: idfc.id, amountPaise: 500_000, direction: "credit", kind: "income", merchant: "Ravi Kumar", occurredAt: at(3).toISOString() });
    await add({ accountId: idfc.id, amountPaise: 300_000, direction: "debit", kind: "expense", merchant: "Ravi Kumar", occurredAt: at(4).toISOString() });
    expect(await db.select().from(schema.loans).all()).toEqual([]);
  });

  it("can be recorded by hand: borrowed now, the payback matched by name later", async () => {
    const { hdfc, indian } = await seedAccounts();
    const money = await add({ accountId: indian.id, amountPaise: 500_000, direction: "credit", kind: "income", merchant: "ANKIT JAIN", occurredAt: at(1).toISOString() });
    const out = await json<{ loan: { id: number; direction: string } }>(api(`/transactions/${money.id}/loan`, { method: "PUT", json: { person: "Ankit" } }));
    expect(out.loan.direction).toBe("you_owe");
    expect((await txn(money.id)).kind).toBe("transfer");
    // Repaid three weeks later: past the short-loan window, matched to the open IOU by name.
    const back = await add({ accountId: hdfc.id, amountPaise: 500_000, direction: "debit", kind: "expense", merchant: "ANKIT JAIN", occurredAt: at(22).toISOString() });
    expect(await txn(back.id)).toMatchObject({ kind: "transfer", loanId: out.loan.id });
    expect((await db.select().from(schema.loans).get())!.status).toBe("settled");
  });
});

describe("salary, card bills, forwarding, balances", () => {
  it("filing a credit under Salary marks it salary, from any account", async () => {
    const { indian } = await seedAccounts();
    await api("/cycles", { method: "POST", json: { startDate: "2026-11-01", plannedSpendPaise: 6_700_000 } });
    const a = await add({ accountId: indian.id, amountPaise: 5_000_000, direction: "credit", kind: "income", occurredAt: at(4, 18, 53).toISOString() });
    const b = await add({ accountId: indian.id, amountPaise: 4_000_000, direction: "credit", kind: "income", occurredAt: at(4, 18, 55).toISOString() });
    const salary = await cat("Salary");
    await api(`/transactions/${a.id}/confirm`, { method: "POST", json: { categoryId: salary } });
    await api(`/transactions/${b.id}`, { method: "PATCH", json: { categoryId: salary } });
    expect((await txn(a.id)).incomeSource).toBe("salary");
    expect((await txn(b.id)).incomeSource).toBe("salary");
    const [cycle] = await db.select().from(schema.budgetCycles).all();
    expect(cycle).toMatchObject({ startDate: "2026-11-01", salaryTxnId: a.id, incomePaise: 5_000_000 + 4_000_000 });
  });

  it("a card bill paid from HDFC pairs with the card's own SMS, even after a rule filed the HDFC payee", async () => {
    const { hdfc, card } = await seedAccounts();
    await api("/rules", { method: "POST", json: { match: "idfc bank credit card", matchType: "substring", categoryId: await cat("Fees & charges") } });
    const debit = fixture("hdfc/upi_debit.txt").replace("Rs.520.00", "Rs.1234.00").replace("HDFC SECURITIES LTD", "IDFC Bank Credit Card Bil").replace("27/10/26", "03/11/26");
    const d = await json<{ transactionId: number }>(postSms("JK-HDFCBK-S", debit, +at(3, 11, 45)));
    const c = await json<{ transactionId: number }>(postSms("AX-IDFCFB-S", fixture("card/payment_received.txt"), +at(3, 11, 46)));
    const [dt, ct] = [await txn(d.transactionId), await txn(c.transactionId)];
    expect(dt).toMatchObject({ accountId: hdfc.id, kind: "card_payment", categoryId: null });
    expect(ct).toMatchObject({ accountId: card.id, kind: "card_payment", direction: "credit" });
    expect(dt.transferGroupId).not.toBeNull();
    expect(ct.transferGroupId).toBe(dt.transferGroupId);
  });

  it("drops a forwarding token pasted after the SMS: not stored, and the same SMS still dedupes", async () => {
    await seedAccounts();
    const sms = fixture("idfc/credit.txt");
    const token = "Bearer Zx9fakeForwardingToken_0123456789";
    expect(normalizeBody(`${sms}${token}${token}`)).toBe(normalizeBody(sms));
    const a = await json<{ smsId: number; status: string }>(postSms("AD-IDFCFB-S", `${sms}${token}${token}`));
    expect(a.status).toBe("created");
    const row = (await db.select().from(schema.smsRaw).where(eq(schema.smsRaw.id, a.smsId)).get())!;
    expect(row.body).not.toContain("Bearer");
    expect(row.hash).toBe(await smsHash("IDFCFB", normalizeBody(sms)));
    expect((await json<{ status: string }>(postSms("AD-IDFCFB-S", sms))).status).toBe("duplicate");
  });

  it("marking an autopay paid finds the debit even when it left from another account", async () => {
    const { hdfc, indian } = await seedAccounts();
    const ap = await json<{ id: number }>(api("/autopays", { method: "POST", json: { name: "Scooty rent", kind: "bill", accountId: indian.id, amountPaise: 578_100, dayOfMonth: 7, nextDueOn: "2026-11-07" } }));
    const debit = await add({ accountId: hdfc.id, amountPaise: 578_100, direction: "debit", kind: "expense", merchant: "ZENITH AUTO", occurredAt: at(7, 9).toISOString() });
    const r = await json<{ linked: boolean; transactionId: number }>(api(`/autopays/${ap.id}/paid`, { method: "POST", json: { paidOn: "2026-11-07" } }));
    expect(r).toMatchObject({ linked: true, transactionId: debit.id });
    expect(await db.select().from(schema.transactions).all()).toHaveLength(1);
  });

  it("warns when a worked-out bank balance goes negative (an SMS is missing)", async () => {
    const { hdfc } = await seedAccounts();
    await api(`/accounts/${hdfc.id}/balance`, { method: "POST", json: { balancePaise: 100_000 } });
    await add({ accountId: hdfc.id, amountPaise: 2_600_000, direction: "debit", kind: "expense", merchant: "Rent", occurredAt: new Date().toISOString() });
    const alert = (await buildAlerts(db)).find((a) => a.key.startsWith("balance_negative"));
    expect(alert?.title).toBe("HDFC Bank shows -₹25,000");
    expect((await buildDashboard(db)).alerts.some((a) => a.key.startsWith("balance_negative"))).toBe(true);
    void env;
  });
});

describe("an SMS that lands just after a hand-set balance", () => {
  // HDFC's UPI alerts give only the day: the debit takes the time it reached the phone, minutes after it happened.
  const sms = fixture("hdfc/upi_debit.txt"); // ₹520 on 27 Oct
  const oct = (h: number, min: number) => istToUtc(2026, 10, 27, h, min);
  const setBalance = (id: number, paise: number, when: Date) => db.update(schema.accounts).set({ openingBalancePaise: paise, openingBalanceAt: when }).where(eq(schema.accounts.id, id));
  const balance = async (id: number) => (await json<{ id: number; balance: { balancePaise: number } }[]>(api("/accounts"))).find((a) => a.id === id)!.balance.balancePaise;
  const review = () => json<{ transactions: Txn[]; lateSms: { transactionId: number; accountId: number; correctedPaise: number }[] }>(api("/review"));

  it("asks whether the balance already had it, and keeps the figure the owner set when it did", async () => {
    const { hdfc } = await seedAccounts();
    await setBalance(hdfc.id, 8_000_000, oct(20, 19));
    const out = await json<{ transactionId: number }>(postSms("JK-HDFCBK-S", sms, oct(20, 22).toISOString()));
    expect((await txn(out.transactionId)).status).toBe("needs_review");
    expect((await review()).lateSms).toEqual([{ transactionId: out.transactionId, accountId: hdfc.id, correctedPaise: 8_000_000, correctedAt: oct(20, 19).toISOString() }]);
    expect(await balance(hdfc.id)).toBe(8_000_000 - 52_000);

    const res = await api(`/accounts/${hdfc.id}/balance/already-included`, { method: "POST", json: { transactionId: out.transactionId } });
    expect(res.status).toBe(200);
    expect(await balance(hdfc.id)).toBe(8_000_000);
    expect((await review()).lateSms).toEqual([]);
    // Once is enough: it's no longer "just after" the balance.
    expect((await api(`/accounts/${hdfc.id}/balance/already-included`, { method: "POST", json: { transactionId: out.transactionId } })).status).toBe(409);
  });

  it("leaves SMS alone that arrive much later, or whose time is a guess (another day)", async () => {
    const { hdfc } = await seedAccounts();
    await setBalance(hdfc.id, 8_000_000, oct(18, 0));
    const later = await json<{ transactionId: number }>(postSms("JK-HDFCBK-S", sms, oct(19, 0).toISOString()));
    expect((await review()).lateSms).toEqual([]);
    expect(await balance(hdfc.id)).toBe(8_000_000 - 52_000);
    // A different day in the SMS than the day it arrived: the time is a guess (noon), not the arrival time.
    await setBalance(hdfc.id, 8_000_000, oct(19, 30));
    await postSms("JK-HDFCBK-S", sms.replace("27/10/26", "26/10/26"), oct(19, 35).toISOString());
    expect((await review()).lateSms).toEqual([]);
    // Not late: the first one stays as it was.
    expect((await api(`/accounts/${hdfc.id}/balance/already-included`, { method: "POST", json: { transactionId: later.transactionId } })).status).toBe(409);
  });
});
