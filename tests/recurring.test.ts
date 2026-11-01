// Recurring-payment finder: subscriptions and bills that aren't tracked as autopays yet.
import { beforeEach, describe, expect, it } from "vitest";
import type { RecurringReport } from "../shared/api";
import { istToUtc } from "../shared/time";
import { findRecurring } from "../worker/ledger/recurring";
import { api, db, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const today = "2026-11-01";
async function charge(accountId: number, merchant: string, amountPaise: number, date: string) {
  const [y, m, d] = date.split("-").map(Number);
  await db.insert(schema.transactions).values({ accountId, merchant, amountPaise, direction: "debit", kind: "expense", occurredAt: istToUtc(y, m, d, 9, 0), source: "manual", status: "confirmed" });
}
beforeEach(resetLedger);

describe("recurring finder", () => {
  it("finds monthly, quarterly and yearly payments, and ignores stopped, irregular and tracked ones", async () => {
    const { card, idfc, indian } = await seedAccounts();
    for (const d of ["2026-07-15", "2026-08-15", "2026-09-14", "2026-10-15"]) await charge(card.id, "NETFLIX", 64_900, d);
    for (const d of ["2026-02-10", "2026-05-10", "2026-08-09"]) await charge(indian.id, "LIC OF INDIA", 500_000, d);
    for (const d of ["2025-10-20", "2026-10-20"]) await charge(card.id, "AMAZON PRIME", 149_900, d);
    // Stopped in July.
    for (const d of ["2026-05-01", "2026-06-01", "2026-07-01"]) await charge(card.id, "SPOTIFY", 11_900, d);
    // Same shop, different amounts every few days: not a subscription.
    for (const [d, a] of [["2026-10-02", 38_000], ["2026-10-09", 52_000], ["2026-10-16", 21_000], ["2026-10-23", 64_000]] as const) await charge(idfc.id, "SWIGGY", a, d);
    // A one-off bigger charge at a recurring merchant doesn't break the pattern.
    await charge(card.id, "NETFLIX", 199_900, "2026-10-20");
    // Already tracked as an autopay.
    await api("/autopays", { method: "POST", json: { name: "Gym", kind: "subscription", accountId: idfc.id, amountPaise: 150_000, dayOfMonth: 5, nextDueOn: "2026-11-05", matchHint: "cult fit" } });
    for (const d of ["2026-08-05", "2026-09-05", "2026-10-05"]) await charge(idfc.id, "CULT FIT", 150_000, d);

    const r = await findRecurring(db, today);
    expect(r.found.map((f) => [f.merchant, f.frequency, f.amountPaise, f.monthlyPaise])).toEqual([
      ["LIC OF INDIA", "quarterly", 500_000, 166_667],
      ["NETFLIX", "monthly", 64_900, 64_900],
      ["AMAZON PRIME", "yearly", 149_900, 12_492],
    ]);
    expect(r.found.find((f) => f.merchant === "NETFLIX")).toMatchObject({ count: 4, lastOn: "2026-10-15", nextOn: "2026-11-15", accountId: card.id });
    expect(r.trackedMonthlyPaise).toBe(150_000);
    expect(r.foundMonthlyPaise).toBe(166_667 + 12_492 + 64_900);
  });

  it("stops suggesting a merchant once dismissed, and once tracked", async () => {
    const { card } = await seedAccounts();
    for (const d of ["2026-08-03", "2026-09-03", "2026-10-03"]) await charge(card.id, "YOUTUBE PREMIUM", 12_900, d);
    for (const d of ["2026-08-07", "2026-09-07", "2026-10-07"]) await charge(card.id, "ICLOUD", 7_500, d);
    let r = await json<RecurringReport>(api("/recurring"));
    expect(r.found).toHaveLength(2);

    await api("/recurring/dismiss", { method: "POST", json: { key: r.found.find((f) => f.merchant === "ICLOUD")!.key } });
    const yt = r.found.find((f) => f.merchant === "YOUTUBE PREMIUM")!;
    await api("/autopays", { method: "POST", json: { name: yt.merchant, kind: "subscription", accountId: yt.accountId, amountPaise: yt.amountPaise, dayOfMonth: 3, nextDueOn: yt.nextOn, matchHint: yt.key } });
    r = await json<RecurringReport>(api("/recurring"));
    expect(r.found).toEqual([]);
  });
});
