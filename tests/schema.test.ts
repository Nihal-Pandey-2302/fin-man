import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../worker/db";

const { accounts, categories, smsRaw, transactions } = schema;
const db = getDb(env.DB);

async function makeAccount() {
  const [a] = await db
    .insert(accounts)
    .values({ name: "IDFC", institution: "IDFC", kind: "bank", role: "spending", last4: "1234" })
    .returning();
  return a;
}

const txn = (accountId: number, over: Partial<typeof transactions.$inferInsert> = {}) => ({
  accountId,
  occurredAt: new Date("2026-10-31T10:00:00Z"),
  amountPaise: 12_345,
  direction: "debit" as const,
  kind: "expense" as const,
  source: "manual" as const,
  ...over,
});

// D1 wraps SQLite errors, so match on the constraint text anywhere in the cause chain.
async function expectConstraint(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "expected the write to be rejected").toBeTruthy();
  let msg = "";
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) msg += ` ${String((e as Error).message ?? e)}`;
  expect(msg).toMatch(pattern);
}

describe("schema", () => {
  beforeEach(async () => {
    // Per-file storage is shared across tests in a file; start each test clean.
    await db.delete(transactions);
    await db.delete(smsRaw);
    await db.delete(accounts);
  });

  it("seeds default categories", async () => {
    const rows = await db.select().from(categories);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.find((c) => c.name === "Groceries")?.isEssential).toBe(true);
  });

  it("round-trips paise as integers and timestamps as UTC instants", async () => {
    const a = await makeAccount();
    const [t] = await db.insert(transactions).values(txn(a.id)).returning();
    expect(t.amountPaise).toBe(12_345);
    expect(t.occurredAt.toISOString()).toBe("2026-10-31T10:00:00.000Z");
    expect(t.status).toBe("confirmed");
    expect(t.createdAt).toBeInstanceOf(Date);
  });

  it("rejects non-positive amounts", async () => {
    const a = await makeAccount();
    await expectConstraint(db.insert(transactions).values(txn(a.id, { amountPaise: 0 })), /CHECK/i);
    await expectConstraint(db.insert(transactions).values(txn(a.id, { amountPaise: -5 })), /CHECK/i);
  });

  it("enforces enums at the DB level", async () => {
    const a = await makeAccount();
    const bad = txn(a.id, { kind: "salary" as never });
    await expectConstraint(db.insert(transactions).values(bad), /CHECK/i);
  });

  it("only allows income_source on income", async () => {
    const a = await makeAccount();
    await expectConstraint(
      db.insert(transactions).values(txn(a.id, { incomeSource: "salary" })),
      /CHECK/i,
    );
    await db
      .insert(transactions)
      .values(txn(a.id, { kind: "income", direction: "credit", incomeSource: "salary" }));
  });

  it("dedupes SMS by hash and allows one transaction per SMS", async () => {
    const sms = {
      sender: "IDFCFB",
      senderRaw: "VM-IDFCFB-S",
      body: "redacted",
      receivedAt: new Date(),
      hash: "a".repeat(64),
      parseStatus: "parsed" as const,
    };
    const [s] = await db.insert(smsRaw).values(sms).returning();
    await expectConstraint(db.insert(smsRaw).values(sms), /UNIQUE/i);

    const a = await makeAccount();
    await db.insert(transactions).values(txn(a.id, { source: "sms", smsId: s.id }));
    await expectConstraint(
      db.insert(transactions).values(txn(a.id, { source: "sms", smsId: s.id })),
      /UNIQUE/i,
    );
  });

  it("refuses to delete an account that has transactions", async () => {
    const a = await makeAccount();
    await db.insert(transactions).values(txn(a.id));
    await expectConstraint(db.delete(accounts).where(eq(accounts.id, a.id)), /FOREIGN KEY/i);
  });

  it("validates last4 format", async () => {
    await expectConstraint(
      db.insert(accounts).values({ name: "x", institution: "HDFC", kind: "bank", last4: "12a4" }),
      /CHECK/i,
    );
  });
});
