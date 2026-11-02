import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Account, Bootstrap, Dashboard, Page, Txn } from "../shared/api";
import { addDays, istDate, istToUtc } from "../shared/time";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res) .json() as Promise<T>;
const category = async (name: string) => (await db.select().from(schema.categories).where(eq(schema.categories.name, name)).get())!;
const at = (h: number, d = 31) => istToUtc(2026, 10, d, h, 0).toISOString();

beforeEach(resetLedger);

describe("accounts & balances", () => {
  it("creates an account with several numbers and recovers SMS that were waiting for it", async () => {
    await postSms("JD-IDFCFB", fixture("card/spend_rupay_swiggy.txt"), at(21));
    const res = await api("/accounts", {
      method: "POST",
      json: {
        name: "IDFC Card", institution: "IDFC", kind: "credit_card", role: "card", creditLimitPaise: 2_500_000,
        numbers: [{ last4: "1111", label: "RuPay" }, { last4: "2222", label: "Mastercard" }],
      },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ recoveredSms: 1 });

    const [card] = await json<Account[]>(api("/accounts"));
    expect(card.numbers.map((n) => n.last4)).toEqual(["1111", "2222"]);
    // Limit 25,000 − available 23,109.86 → 1,890.14 outstanding.
    expect(card.balance).toMatchObject({ balancePaise: 189_014, basis: "sms", availableLimitPaise: 2_310_986 });
  });

  it("anchors bank balances on the latest SMS balance and adds later transactions", async () => {
    const { idfc, cash } = await seedAccounts();
    await postSms("VM-IDFCFB", fixture("idfc/upi_debit.txt"), at(10, 30)); // balance after: 1,360
    await postSms("VM-IDFCFB", fixture("idfc/credit.txt"), at(10, 31)); // balance after: 3,360
    // A later manual spend on IDFC without a balance in it.
    await api("/transactions", {
      method: "POST",
      json: { accountId: idfc.id, amountPaise: 10_000, direction: "debit", kind: "expense", occurredAt: at(12) },
    });
    // Cash: opening balance + manual spends.
    await api(`/accounts/${cash.id}/balance`, { method: "POST", json: { balancePaise: 50_000 } });
    await api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise: 2_000, direction: "debit", kind: "expense" } });

    const list = await json<Account[]>(api("/accounts"));
    expect(list.find((a) => a.id === idfc.id)!.balance).toMatchObject({ balancePaise: 326_000, basis: "sms" });
    expect(list.find((a) => a.id === cash.id)!.balance).toMatchObject({ balancePaise: 48_000, basis: "manual" });
  });

  it("a manual correction newer than the last SMS wins", async () => {
    const { idfc } = await seedAccounts();
    await postSms("VM-IDFCFB", fixture("idfc/credit.txt"), at(10, 31));
    await api(`/accounts/${idfc.id}/balance`, { method: "POST", json: { balancePaise: 99_900 } });
    const list = await json<Account[]>(api("/accounts"));
    expect(list.find((a) => a.id === idfc.id)!.balance).toMatchObject({ balancePaise: 99_900, basis: "manual" });
  });

  it("archives instead of deleting an account with history", async () => {
    const { cash } = await seedAccounts();
    await api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise: 100, direction: "debit", kind: "expense" } });
    expect(await json(api(`/accounts/${cash.id}`, { method: "DELETE" }))).toEqual({ archived: true });
  });
});

describe("transactions", () => {
  it("lists newest first with a stable cursor, search and filters", async () => {
    const { cash } = await seedAccounts();
    const food = await category("Food & dining");
    for (let i = 0; i < 5; i++) {
      await api("/transactions", {
        method: "POST",
        json: { accountId: cash.id, amountPaise: 1000 + i, direction: "debit", kind: "expense", merchant: i % 2 ? "Chai Point" : "Metro", categoryId: i % 2 ? food.id : null, occurredAt: at(10 + i) },
      });
    }
    const p1 = await json<Page<Txn>>(api("/transactions?limit=2"));
    expect(p1.items.map((t) => t.amountPaise)).toEqual([1004, 1003]);
    const p2 = await json<Page<Txn>>(api(`/transactions?limit=2&cursor=${p1.nextCursor}`));
    expect(p2.items.map((t) => t.amountPaise)).toEqual([1002, 1001]);
    const p3 = await json<Page<Txn>>(api(`/transactions?limit=2&cursor=${p2.nextCursor}`));
    expect(p3.items.map((t) => t.amountPaise)).toEqual([1000]);
    expect(p3.nextCursor).toBeNull();

    expect((await json<Page<Txn>>(api("/transactions?q=chai"))).items).toHaveLength(2);
    expect((await json<Page<Txn>>(api("/transactions?q=10.03"))).items.map((t) => t.amountPaise)).toEqual([1003]);
    expect((await json<Page<Txn>>(api("/transactions?categoryId=none"))).items).toHaveLength(3);
    expect((await json<Page<Txn>>(api("/transactions?from=2026-10-31&to=2026-10-31"))).items).toHaveLength(5);
    expect((await json<Page<Txn>>(api("/transactions?to=2026-10-30"))).items).toHaveLength(0);
  });

  it("re-categorising learns a rule and clears the same merchant from the inbox", async () => {
    await seedAccounts();
    const food = await category("Food & dining");
    await postSms("VM-IDFCFB", fixture("idfc/upi_debit.txt"), at(10, 30)); // HEY HABIBI, needs review
    const other = fixture("idfc/upi_debit.txt").replace("2,396.00", "450.00").replace("600000000001", "600000000099");
    await postSms("VM-IDFCFB", other, at(11, 30));
    const [first] = (await json<Page<Txn>>(api("/transactions?status=needs_review"))).items;

    const res = await json<{ ruleId: number; appliedTo: number }>(
      api(`/transactions/${first.id}/confirm`, { method: "POST", json: { categoryId: food.id } }),
    );
    expect(res.ruleId).toBeTruthy();
    expect(res.appliedTo).toBe(1);
    expect((await json<Page<Txn>>(api("/transactions?status=needs_review"))).items).toHaveLength(0);

    // The next HEY HABIBI SMS is categorised on arrival.
    await postSms("VM-IDFCFB", other.replace("600000000099", "600000000100"), at(12, 30));
    const [latest] = (await json<Page<Txn>>(api("/transactions?limit=1"))).items;
    expect(latest).toMatchObject({ categoryId: food.id, status: "confirmed" });
  });

  it("deleting an SMS transaction keeps the SMS but stops it coming back", async () => {
    await seedAccounts();
    const { smsId, transactionId } = await json<{ smsId: number; transactionId: number }>(
      postSms("VM-IDFCFB", fixture("idfc/upi_debit.txt"), at(10, 30)),
    );
    await api(`/transactions/${transactionId}`, { method: "DELETE" });
    expect(await json(api(`/review/sms/${smsId}/reprocess`, { method: "POST" }))).toMatchObject({ status: "ignored", reason: "deleted_by_user" });
    expect(await db.select().from(schema.transactions)).toHaveLength(0);
  });

  it("manual transfers create two linked legs and a card payment when paying the card", async () => {
    const { hdfc, card } = await seedAccounts();
    const res = await json<{ transactions: Txn[] }>(
      api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: card.id, amountPaise: 500_000 } }),
    );
    expect(res.transactions.map((t) => [t.direction, t.kind])).toEqual([
      ["debit", "card_payment"],
      ["credit", "card_payment"],
    ]);
  });

  it("creates a transaction from an unparsed SMS", async () => {
    const { hdfc } = await seedAccounts();
    const { smsId } = await json<{ smsId: number }>(postSms("VM-HDFCBK", "Rs.250 debited from HDFC Bank A/c XX4444 at SOME NEW FORMAT"));
    const res = await api("/transactions", {
      method: "POST",
      json: { accountId: hdfc.id, amountPaise: 25_000, direction: "debit", kind: "expense", merchant: "Some shop", smsId },
    });
    expect(res.status).toBe(201);
    const review = await json<{ sms: unknown[] }>(api("/review"));
    expect(review.sms).toHaveLength(0);
  });
});

describe("dashboard", () => {
  it("computes safe-to-spend from the cycle budget, spends and autopays still due", async () => {
    const { idfc, indian, card } = await seedAccounts();
    const today = istDate();
    const start = addDays(today, -5);
    await api("/cycles", { method: "POST", json: { startDate: start, plannedSpendPaise: 3_000_000 } });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const now = new Date().toISOString();
    const spend = (accountId: number, amountPaise: number, occurredAt: string, kind = "expense") =>
      api("/transactions", { method: "POST", json: { accountId, amountPaise, direction: "debit", kind, occurredAt } });
    await spend(idfc.id, 200_000, yesterday);
    await spend(card.id, 50_000, now);
    await spend(indian.id, 500_000, now, "investment"); // not spending
    await api("/transfers", { method: "POST", json: { fromAccountId: idfc.id, toAccountId: indian.id, amountPaise: 1_000_000 } }); // not spending
    await api("/autopays", {
      method: "POST",
      json: { name: "Rent", kind: "bill", accountId: indian.id, amountPaise: 400_000, dayOfMonth: Number(addDays(today, 3).slice(8)), nextDueOn: addDays(today, 3) },
    });
    await api("/autopays", {
      method: "POST",
      json: { name: "SIP", kind: "sip", accountId: indian.id, amountPaise: 300_000, dayOfMonth: Number(addDays(today, 2).slice(8)), nextDueOn: addDays(today, 2) },
    });

    const d = await json<Dashboard>(api("/dashboard"));
    expect(d.cycle).toMatchObject({ startDate: start, budgetPaise: 3_000_000, spentPaise: 250_000, spentTodayPaise: 50_000, autopaysDuePaise: 400_000 });
    const daysLeft = d.cycle.daysLeft;
    const allowance = Math.floor((3_000_000 - 200_000 - 400_000) / daysLeft);
    expect(d.cycle.dailyAllowancePaise).toBe(allowance);
    expect(d.cycle.leftTodayPaise).toBe(allowance - 50_000);
    expect(d.upcomingAutopays.map((a) => a.name)).toEqual(["SIP", "Rent"]);
    expect(d.daily.reduce((s, x) => s + x.spentPaise, 0)).toBe(250_000);
  });

  it("falls back to the calendar month without a cycle", async () => {
    const d = await json<Dashboard>(api("/dashboard"));
    expect(d.cycle.id).toBeNull();
    expect(d.cycle.startDate.endsWith("-01")).toBe(true);
    expect(d.cycle.budgetPaise).toBe(0);
  });

  it("starting a new cycle closes the previous one", async () => {
    await api("/cycles", { method: "POST", json: { startDate: "2026-09-01", plannedSpendPaise: 1 } });
    await api("/cycles", { method: "POST", json: { startDate: "2026-10-01", plannedSpendPaise: 2 } });
    const cycles = await json<{ startDate: string; endDate: string | null }[]>(api("/cycles"));
    expect(cycles.map((c) => [c.startDate, c.endDate])).toEqual([
      ["2026-10-01", null],
      ["2026-09-01", "2026-09-30"],
    ]);
  });
});

describe("plan, settings, export", () => {
  it("tracks loan repayments and settles automatically", async () => {
    const loan = await json<{ id: number }>(
      api("/loans", { method: "POST", json: { person: "Friend", direction: "they_owe", principalPaise: 100_000, openedOn: "2026-10-01" } }),
    );
    await api(`/loans/${loan.id}/payments`, { method: "POST", json: { amountPaise: 40_000, paidOn: "2026-10-10" } });
    let [l] = await json<{ status: string; paidPaise: number }[]>(api("/loans"));
    expect(l).toMatchObject({ status: "partially_paid", paidPaise: 40_000 });
    await api(`/loans/${loan.id}/payments`, { method: "POST", json: { amountPaise: 60_000, paidOn: "2026-10-20" } });
    [l] = await json<{ status: string; paidPaise: number }[]>(api("/loans"));
    expect(l.status).toBe("settled");
  });

  it("autopay paid advances the due date by its frequency, clamped to short months", async () => {
    const { indian } = await seedAccounts();
    const a = await json<{ id: number }>(
      api("/autopays", { method: "POST", json: { name: "Insurance", kind: "insurance", accountId: indian.id, amountPaise: 100, frequency: "quarterly", dayOfMonth: 31, nextDueOn: "2026-10-31" } }),
    );
    expect(await json(api(`/autopays/${a.id}/paid`, { method: "POST" }))).toMatchObject({ nextDueOn: "2027-01-31" });
    expect(await json(api(`/autopays/${a.id}/paid`, { method: "POST" }))).toMatchObject({ nextDueOn: "2027-04-30" });
  });

  it("saves settings and serves the bootstrap bundle", async () => {
    await seedAccounts();
    await api("/settings", { method: "PATCH", json: { owner_names: ["Test Owner"], liquid_buffer_paise: 1_000_000 } });
    const b = await json<Bootstrap>(api("/bootstrap"));
    expect(b.accounts).toHaveLength(5);
    expect(b.settings).toMatchObject({ owner_names: ["Test Owner"], liquid_buffer_paise: 1_000_000 });
    expect(b.categories.length).toBeGreaterThan(10);
  });

  it("exports every table as JSON", async () => {
    await seedAccounts();
    const res = await api("/export");
    expect(res.headers.get("content-disposition")).toMatch(/fintrack-.*\.json/);
    const body = await json<{ tables: Record<string, unknown[]> }>(res);
    expect(body.tables.accounts).toHaveLength(5);
    expect(Object.keys(body.tables)).toContain("transactions");
  });

  it("validates input", async () => {
    const bad = await api("/transactions", { method: "POST", json: { accountId: 1, amountPaise: -5, direction: "debit", kind: "expense" } });
    expect(bad.status).toBe(400);
  });
});

describe("SMS backup import", () => {
  it("ingests a batch through the same pipeline and stays idempotent", async () => {
    await seedAccounts();
    const messages = [
      { sender: "VM-IDFCFB", body: fixture("idfc/upi_debit.txt"), receivedAt: Date.parse(at(10, 30)) },
      { sender: "JD-IDFCFB-S", body: fixture("card/spend_rupay_swiggy.txt"), receivedAt: Date.parse(at(21)) },
      { sender: "VM-RANDOM", body: "Your order shipped", receivedAt: Date.parse(at(9)) },
    ];
    expect(await json(api("/import/sms", { method: "POST", json: { messages } }))).toEqual({ created: 2, duplicate: 0, ignored: 0, unparsed: 0, rejected: 1 });
    expect(await json(api("/import/sms", { method: "POST", json: { messages } }))).toMatchObject({ created: 0, duplicate: 2 });
    const tooMany = Array.from({ length: 21 }, () => messages[0]);
    expect((await api("/import/sms", { method: "POST", json: { messages: tooMany } })).status).toBe(400);
  });
});

describe("CSV export", () => {
  it("exports transactions with IST times, rupee amounts and quoted text", async () => {
    const { cash } = await seedAccounts();
    await api("/transactions", {
      method: "POST",
      json: { accountId: cash.id, amountPaise: 12_345, direction: "debit", kind: "expense", merchant: 'Chai, "Point"', occurredAt: istToUtc(2026, 10, 31, 20, 5).toISOString() },
    });
    const res = await api("/export.csv");
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const [header, row] = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(header.startsWith("date_ist,time_ist,account,direction,amount_inr")).toBe(true);
    expect(row).toBe('2026-10-31,20:05,Cash,debit,123.45,expense,,"Chai, ""Point""",,,,confirmed,manual');
  });
});
