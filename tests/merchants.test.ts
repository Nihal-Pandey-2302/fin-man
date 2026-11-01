// Merchant pages: one merchant across spellings, its totals and months, and re-filing its category.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { MerchantDetail } from "../shared/api";
import { merchantPath, ruleKey } from "../shared/merchant";
import { istToUtc } from "../shared/time";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const cat = async (name: string) => (await db.select().from(schema.categories).where(eq(schema.categories.name, name)).get())!.id;
const at = (m: number, d: number) => istToUtc(2026, m, d, 12, 0).toISOString();
beforeEach(resetLedger);

describe("merchant pages", () => {
  it("groups every spelling, nets refunds, and charts the months", async () => {
    const { card, cash } = await seedAccounts();
    await postSms("JD-IDFCFB-S", fixture("card/spend_rupay_swiggy.txt")); // ₹380, 31 Oct, seeded rule → Food
    await api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise: 25_000, direction: "debit", kind: "expense", merchant: "Swiggy Pvt Ltd", occurredAt: at(9, 14) } });
    await api("/transactions", { method: "POST", json: { accountId: card.id, amountPaise: 10_000, direction: "credit", kind: "refund", merchant: "SWIGGY", occurredAt: at(10, 31) } });
    expect(merchantPath("Swiggy Pvt Ltd")).toBe("/merchant/swiggy");

    const m = await json<MerchantDetail>(api("/merchants/swiggy"));
    expect(m).toMatchObject({ key: "swiggy", name: "Swiggy", count: 3, spentPaise: 38_000 + 25_000 - 10_000, receivedPaise: 0, avgPaise: 31_500, firstOn: "2026-09-14", lastOn: "2026-10-31" });
    expect(m.categoryId).toBe(await cat("Food & dining"));
    expect(m.rule?.match).toBe("swiggy");
    expect(m.transactions).toHaveLength(3);
    expect(m.monthly).toHaveLength(12);
    expect(m.monthly.find((x) => x.month === "2026-10")?.spentPaise).toBe(28_000);
    expect(m.monthly.find((x) => x.month === "2026-09")?.spentPaise).toBe(25_000);
    expect((await api("/merchants/nobody-here")).status).toBe(404);
    expect((await api("/merchants/swiggy", { auth: false })).status).toBe(401);
  });

  it("re-files a merchant from now on, and its past payments when asked", async () => {
    const { cash } = await seedAccounts();
    const sms = await json<{ transactionId: number }>(postSms("JD-IDFCFB-S", fixture("card/spend_rupay_pitstop.txt"))); // uncategorised
    await api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise: 9_000, direction: "debit", kind: "expense", merchant: "Pitstop", categoryId: await cat("Food & dining"), occurredAt: at(10, 2) } });
    const fuel = await cat("Fuel");
    const key = encodeURIComponent(ruleKey("PITSTOP"));

    // From now on: the rule, plus anything still uncategorised.
    expect(await json(api(`/merchants/${key}/category`, { method: "POST", json: { categoryId: fuel } }))).toEqual({ changed: 1 });
    let rows = await db.select().from(schema.transactions).all();
    expect(rows.find((t) => t.id === sms.transactionId)?.categoryId).toBe(fuel);
    expect(rows.filter((t) => t.categoryId === fuel)).toHaveLength(1);

    // And the past.
    expect(await json(api(`/merchants/${key}/category`, { method: "POST", json: { categoryId: fuel, applyToPast: true } }))).toEqual({ changed: 1 });
    rows = await db.select().from(schema.transactions).all();
    expect(rows.every((t) => t.categoryId === fuel && t.status === "confirmed")).toBe(true);
    // New PITSTOP payments follow the rule.
    expect((await json<MerchantDetail>(api(`/merchants/${key}`))).rule?.categoryId).toBe(fuel);
  });
});
