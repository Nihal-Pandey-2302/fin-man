// The Sunday digest: the week's spending, the cycle, and what's due next week.
import { eq } from "drizzle-orm";
import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { istToUtc } from "../shared/time";
import { buildDigest, DIGEST_CRON, digestNote, runDigest } from "../worker/ledger/digest";
import { setSetting } from "../worker/ledger/settings";
import wranglerConfig from "../wrangler.jsonc?raw";
import { api, db, resetLedger, schema, seedAccounts } from "./helpers";

const ist = (m: number, d: number, h = 12) => istToUtc(2026, m, d, h, 0).toISOString();
const cat = async (name: string) => (await db.select().from(schema.categories).where(eq(schema.categories.name, name)).get())!.id;
beforeEach(resetLedger);

it("sums up the week, the cycle and what's coming, in one short push", async () => {
  const { cash, indian, card } = await seedAccounts();
  await api("/cycles", { method: "POST", json: { startDate: "2026-11-01", plannedSpendPaise: 3_000_000 } });
  const spend = (amountPaise: number, categoryId: number, at: string) =>
    api("/transactions", { method: "POST", json: { accountId: cash.id, amountPaise, direction: "debit", kind: "expense", categoryId, occurredAt: at } });
  const food = await cat("Food & dining");
  await spend(50_000, food, ist(11, 3));
  await spend(30_000, food, ist(11, 5));
  await spend(20_000, await cat("Transport"), ist(11, 6));
  await spend(150_000, await cat("Groceries"), ist(10, 28)); // the week before
  await api("/autopays", { method: "POST", json: { name: "Car EMI", kind: "emi", accountId: indian.id, amountPaise: 612_000, dayOfMonth: 12, nextDueOn: "2026-11-12" } });
  await db.update(schema.accounts).set({ creditLimitPaise: 5_000_000, statementDay: 20, dueDay: 10, openingBalancePaise: 2_000_000, openingBalanceAt: new Date(ist(10, 25)) }).where(eq(schema.accounts.id, card.id));
  await api(`/cards/${card.id}/statement`, { method: "PUT", json: { statementDate: "2026-10-20", amountPaise: 2_000_000 } });

  const now = new Date(ist(11, 8, 19)); // Sunday evening
  const g = await buildDigest(db, now);
  expect(g).toMatchObject({ weekStart: "2026-11-02", weekEnd: "2026-11-08", spentPaise: 100_000, previousPaise: 150_000, reviewCount: 0 });
  expect(g.top).toEqual({ name: "Food & dining", emoji: "🍔", spentPaise: 80_000 });
  expect(g.coming).toEqual([
    { name: "Card bill", amountPaise: 2_000_000, dueOn: "2026-11-10" },
    { name: "Car EMI", amountPaise: 612_000, dueOn: "2026-11-12" },
  ]);
  const left = 3_000_000 - 100_000 - 612_000;
  expect(g.cycle).toEqual({ leftPaise: left, daysLeft: 23, perDayPaise: Math.floor(left / 23) });

  const note = digestNote(g);
  expect(note.title).toBe("Your week: ₹1,000 spent (down from ₹1,500)");
  expect(note.body).toContain("Most on 🍔 Food & dining: ₹800.");
  expect(note.body).toContain("Coming up: Card bill ₹20,000 (10 Nov), Car EMI ₹6,120 (12 Nov).");
  expect(note.tag).toBe("digest:2026-11-08");
});

it("says so when the week was quiet, and can be switched off", async () => {
  expect(digestNote(await buildDigest(db, new Date(ist(11, 8, 19))))).toMatchObject({ title: "Your week: ₹0 spent", body: "A quiet week." });
  await setSetting(db, "weekly_digest", false);
  expect(await runDigest(db, env)).toEqual({ sent: 0, skipped: "off" });
  expect(wranglerConfig).toContain(`"${DIGEST_CRON}"`);
});
