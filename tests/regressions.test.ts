// Regression tests for issues found in code review (2026-11-01).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Account, Dashboard, Page, Txn } from "../shared/api";
import { addDays, addMonths, istDate } from "../shared/time";
import { currentCycle } from "../worker/ledger/cycles";
import { isOwnerName } from "../worker/ledger/matcher";
import { findRule, ruleKey, type Rule } from "../worker/ledger/rules";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
beforeEach(resetLedger);

describe("cycles roll forward", () => {
  it("an open cycle past its month rolls into monthly periods from its start date", async () => {
    await db.insert(schema.budgetCycles).values({ startDate: "2026-09-05", plannedSpendPaise: 100 });
    expect(await currentCycle(db, "2026-11-01")).toEqual({ id: null, startDate: "2026-10-05", endDate: "2026-11-04", budgetPaise: 100 });
    expect(await currentCycle(db, "2026-10-04")).toMatchObject({ startDate: "2026-09-05", endDate: "2026-10-04" });
  });

  it("the dashboard of a stale cycle counts today's spending", async () => {
    const { cash } = await seedAccounts();
    const today = istDate();
    await api("/cycles", { method: "POST", json: { startDate: addMonths(addDays(today, -3), -3), plannedSpendPaise: 3_000_000 } });
    await api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise: 5_000, direction: "debit", kind: "expense" } });
    const d = await json<Dashboard>(api("/dashboard"));
    expect(d.cycle.spentTodayPaise).toBe(5_000);
    expect(d.cycle.daysLeft).toBeGreaterThan(1);
  });
});

describe("learned rules match the merchant they came from", () => {
  it("normalised keys still match punctuated merchants", () => {
    const rule = { id: 1, match: ruleKey("Swiggy*Instamart"), matchType: "substring", categoryId: 1, kindOverride: null, hits: 0 } as unknown as Rule;
    expect(rule.match).toBe("swiggy instamart");
    expect(findRule([rule], "Swiggy*Instamart", null)).toBe(rule);
    expect(findRule([rule], "SWIGGY INSTAMART BLR", null)).toBe(rule);
  });

  it("re-categorising a punctuated merchant categorises its next SMS", async () => {
    await seedAccounts();
    const body = (merchant: string, ref: string) =>
      fixture("idfc/upi_debit.txt").replace("HEY HABIBI", merchant).replace("600000000001", ref);
    await postSms("VM-IDFCFB", body("D'MART", "600000000201"));
    const [t] = (await json<Page<Txn>>(api("/transactions"))).items;
    const groceries = (await db.select().from(schema.categories).where(eq(schema.categories.name, "Groceries")).get())!;
    await api(`/transactions/${t.id}/confirm`, { method: "POST", json: { categoryId: groceries.id } });
    await postSms("VM-IDFCFB", body("D'MART", "600000000202"));
    const [latest] = (await json<Page<Txn>>(api("/transactions?limit=1"))).items;
    expect(latest).toMatchObject({ categoryId: groceries.id, status: "confirmed" });
  });
});

describe("accounts", () => {
  it("archives (not 500s) an account referenced only by an autopay", async () => {
    const { indian } = await seedAccounts();
    await api("/autopays", { method: "POST", json: { name: "SIP", kind: "sip", accountId: indian.id, amountPaise: 100, dayOfMonth: 5 } });
    const res = await api(`/accounts/${indian.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archived: true });
  });

  it("an SMS whose parser throws is isolated and doesn't break account saves", async () => {
    const { indian } = await seedAccounts();
    const bad = fixture("indian/autopay_notice.txt").replace("07-Aug-26", "07-Sxp-26");
    const out = await json<{ status: string; reason: string }>(postSms("VM-INDBNK", bad));
    expect(out.status).toBe("unparsed");
    expect(out.reason).toMatch(/^parser_error/);
    const res = await api(`/accounts/${indian.id}`, { method: "PATCH", json: { numbers: [{ last4: "7777" }] } });
    expect(res.status).toBe(200);
    const review = await json<{ sms: { parseStatus: string }[] }>(api("/review"));
    expect(review.sms.map((s) => s.parseStatus)).toEqual(["error"]);
  });
});

describe("transfers", () => {
  it("editing a paired leg's amount unpairs both legs", async () => {
    const { hdfc, idfc } = await seedAccounts();
    const { transactions: legs } = await json<{ transactions: Txn[] }>(
      api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: idfc.id, amountPaise: 50_000 } }),
    );
    await api(`/transactions/${legs[0].id}`, { method: "PATCH", json: { amountPaise: 500_000 } });
    const rows = await db.select().from(schema.transactions);
    expect(rows.every((r) => r.transferGroupId === null)).toBe(true);
    expect(rows.find((r) => r.id === legs[1].id)).toMatchObject({ kind: "income", status: "needs_review" });
  });

  it("owner-name matching is strict", () => {
    const owner = ["Nihal K Pandey"];
    expect(isOwnerName("NIHAL KAPOOR", owner)).toBe(false);
    expect(isOwnerName("NIHAL", owner)).toBe(false);
    expect(isOwnerName("NIHAL K PANDEY", owner)).toBe(true);
    expect(isOwnerName("NIHAL PANDEY", owner)).toBe(true);
    expect(isOwnerName("PANDEY NIHAL", owner)).toBe(true);
    expect(isOwnerName("NIHAL P", ["Nihal Pandey"])).toBe(true);
    expect(isOwnerName("NIHAL PANDE", ["Nihal Pandey"])).toBe(true);
    expect(isOwnerName("NIHAL KUMAR", ["Nihal Pandey"])).toBe(false);
  });
});

describe("ingest", () => {
  it("rejects OTPs from unknown senders without storing anything", async () => {
    const out = await json(postSms("VM-AMAZON", "123456 is your OTP for login. Do not share."));
    expect(out).toMatchObject({ status: "rejected" });
    expect(await db.select().from(schema.smsRaw)).toHaveLength(0);
  });
});

describe("misc", () => {
  it("renaming an account doesn't reprocess parked SMS", async () => {
    await postSms("VM-HDFCBK", fixture("hdfc/upi_debit.txt"));
    const { hdfc } = await seedAccounts(); // seeded directly, not via API → SMS still parked
    const res = await json<{ recoveredSms: number }>(api(`/accounts/${hdfc.id}`, { method: "PATCH", json: { name: "HDFC Salary" } }));
    expect(res.recoveredSms).toBe(0);
    const res2 = await json<{ recoveredSms: number }>(api(`/accounts/${hdfc.id}`, { method: "PATCH", json: { numbers: [{ last4: "4444" }] } }));
    expect(res2.recoveredSms).toBe(1);
    expect((await json<Account[]>(api("/accounts"))).find((a) => a.id === hdfc.id)?.name).toBe("HDFC Salary");
  });
});
