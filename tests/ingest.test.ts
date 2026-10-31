import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { istToUtc } from "../shared/time";
import { parseReceivedAt } from "../worker/routes/ingest";
import { setSetting } from "../worker/ledger/settings";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const { smsRaw, transactions, categories } = schema;
const at = (h: number, d = 31) => istToUtc(2026, 10, d, h, 0).toISOString();

describe("POST /api/ingest/sms", () => {
  beforeEach(resetLedger);

  it("requires the bearer secret", async () => {
    const res = await postSms("VM-IDFCFB", fixture("idfc/credit.txt"), at(10), "wrong");
    expect(res.status).toBe(401);
    expect(await db.select().from(smsRaw)).toHaveLength(0);
    const none = await api("/ingest/sms", { method: "POST", json: { sender: "x", body: "y" } });
    expect(none.status).toBe(401);
  });

  it("rejects malformed payloads", async () => {
    const res = await postSms("", "", at(10));
    expect(res.status).toBe(400);
  });

  it("creates a categorised, confirmed card spend from a rule", async () => {
    const { card } = await seedAccounts();
    const res = await postSms("JD-IDFCFB-S", fixture("card/spend_rupay_swiggy.txt"), at(21));
    expect(await res.json()).toMatchObject({ status: "created" });

    const [t] = await db.select().from(transactions);
    const food = await db.select().from(categories).where(eq(categories.name, "Food & dining")).get();
    expect(t).toMatchObject({
      accountId: card.id,
      amountPaise: 38_000,
      direction: "debit",
      kind: "expense",
      categoryId: food!.id,
      merchant: "Swiggy",
      availableLimitPaise: 2_310_986,
      channel: "card",
      source: "sms",
      status: "confirmed",
    });
  });

  it("routes both card numbers to the one card account", async () => {
    const { card } = await seedAccounts();
    await postSms("JD-IDFCFB", fixture("card/spend_rupay_pitstop.txt"), at(17, 30));
    await postSms("JD-IDFCFB", fixture("card/spend_mastercard_blinkit.txt"), at(12, 29));
    const rows = await db.select().from(transactions);
    expect(rows.map((r) => r.accountId)).toEqual([card.id, card.id]);
  });

  it("is idempotent across retries and delivery routes", async () => {
    await seedAccounts();
    const body = fixture("idfc/upi_debit.txt");
    const first = await (await postSms("VM-IDFCFB-S", body, at(10, 30))).json();
    const second = await (await postSms("JD-IDFCFB", `${body}\r\n`, at(11, 30))).json();
    expect(first).toMatchObject({ status: "created" });
    expect(second).toMatchObject({ status: "duplicate", smsId: (first as { smsId: number }).smsId });
    expect(await db.select().from(transactions)).toHaveLength(1);
    expect(await db.select().from(smsRaw)).toHaveLength(1);
  });

  it("stores OTPs only as a blank ignored marker", async () => {
    const res = await postSms("JD-IDFCFB", fixture("other/synthetic_otp.txt"), at(10));
    expect(await res.json()).toMatchObject({ status: "ignored", reason: "otp" });
    const [row] = await db.select().from(smsRaw);
    expect(row.body).toBe("");
    expect(row.parseStatus).toBe("ignored");
    // A retried OTP is still a duplicate.
    expect(await (await postSms("JD-IDFCFB", fixture("other/synthetic_otp.txt"))).json()).toMatchObject({
      status: "duplicate",
    });
  });

  it("ignores bank promos and rejects unknown senders without storing them", async () => {
    expect(await (await postSms("VM-HDFCBK", fixture("other/synthetic_promo.txt"))).json()).toMatchObject({
      status: "ignored",
      reason: "promo",
    });
    expect(await (await postSms("VM-RANDOM", "Your Zomato order is out for delivery"))
      .json()).toMatchObject({ status: "rejected" });
    expect(await db.select().from(smsRaw)).toHaveLength(1);
  });

  it("keeps autopay heads-up notices structured, without creating a transaction", async () => {
    await seedAccounts();
    const out = await (await postSms("VM-INDBNK", fixture("indian/autopay_notice.txt"))).json();
    expect(out).toMatchObject({ status: "ignored", reason: "autopay_upcoming" });
    const [row] = await db.select().from(smsRaw);
    expect(JSON.parse(row.parsedJson!)).toMatchObject({ payee: "Royal Bison Autorent", dueOn: "2026-08-07" });
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("parks an SMS for an unknown account as unparsed, with the reason", async () => {
    const out = await (await postSms("VM-HDFCBK", fixture("hdfc/upi_debit.txt"), at(10, 27))).json();
    expect(out).toMatchObject({ status: "unparsed", reason: "no_account:HDFC:bank:4444" });
  });

  it("sends uncategorised spends and credits to the review inbox", async () => {
    await seedAccounts();
    await postSms("VM-IDFCFB", fixture("idfc/upi_debit.txt"), at(10, 30));
    await postSms("VM-INDBNK", fixture("indian/upi_credit.txt"));
    const rows = await db.select().from(transactions);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["expense", "needs_review"],
      ["income", "needs_review"],
    ]);
  });

  it("applies kind overrides from rules (HDFC Securities → investment)", async () => {
    await seedAccounts();
    await postSms("VM-HDFCBK", fixture("hdfc/upi_debit.txt"), at(10, 27));
    const [t] = await db.select().from(transactions);
    expect(t.kind).toBe("investment");
    expect(t.status).toBe("confirmed");
  });

  it("pairs an own-account transfer (HDFC → IDFC) and keeps it out of spending", async () => {
    const { hdfc, idfc } = await seedAccounts();
    await setSetting(db, "owner_names", ["Test Owner"]);
    // HDFC debit to the owner (synthetic, same wording as the real HDFC sample) + the real IDFC credit.
    const hdfcDebit = fixture("hdfc/upi_debit.txt").replace("Rs.520.00", "Rs.2000.00").replace("HDFC SECURITIES LTD", "TEST OWNER").replace("27/10/26", "31/10/26");
    await postSms("VM-HDFCBK", hdfcDebit, at(9, 31));
    await postSms("VM-IDFCFB", fixture("idfc/credit.txt"), at(10, 31));

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(2);
    const debit = rows.find((r) => r.accountId === hdfc.id)!;
    const credit = rows.find((r) => r.accountId === idfc.id)!;
    expect(debit.kind).toBe("transfer");
    expect(credit.kind).toBe("transfer");
    expect(debit.transferGroupId).toBe(credit.transferGroupId);
    expect(debit.transferGroupId).toBeTruthy();
    expect([debit.status, credit.status]).toEqual(["confirmed", "confirmed"]);
  });

  it("pairs but flags for review when a third party is named", async () => {
    await seedAccounts();
    const hdfcDebit = fixture("hdfc/upi_debit.txt").replace("Rs.520.00", "Rs.2000.00").replace("HDFC SECURITIES LTD", "SOMEONE ELSE").replace("27/10/26", "31/10/26");
    await postSms("VM-HDFCBK", hdfcDebit, at(9, 31));
    await postSms("VM-IDFCFB", fixture("idfc/credit.txt"), at(10, 31));
    const rows = await db.select().from(transactions);
    expect(rows.every((r) => r.kind === "transfer" && r.status === "needs_review")).toBe(true);
  });
});

describe("parseReceivedAt", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("accepts epoch seconds, epoch ms, numeric strings and ISO", () => {
    expect(parseReceivedAt(1_761_900_000, now).toISOString()).toBe("2025-10-31T08:40:00.000Z");
    expect(parseReceivedAt(1_761_900_000_000, now).toISOString()).toBe("2025-10-31T08:40:00.000Z");
    expect(parseReceivedAt("1761900000", now).toISOString()).toBe("2025-10-31T08:40:00.000Z");
    expect(parseReceivedAt("2026-10-31T20:28:00+05:30", now).toISOString()).toBe("2026-10-31T14:58:00.000Z");
  });
  it("falls back to now for junk or implausible values", () => {
    expect(parseReceivedAt(undefined, now)).toBe(now);
    expect(parseReceivedAt("not a date", now)).toBe(now);
    expect(parseReceivedAt("2030-01-01T00:00:00Z", now)).toBe(now);
  });
});
