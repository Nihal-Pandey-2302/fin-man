import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Account } from "../../shared/api";
import type { Db } from "../db";
import { ACCOUNT_KINDS, ACCOUNT_ROLES, accountNumbers, accounts, autopays, INSTITUTIONS, transactions } from "../db/schema";
import { computeBalances } from "../ledger/balances";
import { reprocessUnparsed } from "../sms/ingest";
import type { AppEnv } from "../types";
import { dayOfMonth, idParam, instant, paise, signedPaise, text } from "./validators";

export async function listAccounts(db: Db): Promise<Account[]> {
  const [rows, numbers] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.archived), asc(accounts.id)).all(),
    db.select().from(accountNumbers).all(),
  ]);
  const balances = await computeBalances(db, rows);
  return rows.map((a) => ({
    ...a,
    openingBalanceAt: a.openingBalanceAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    numbers: numbers.filter((n) => n.accountId === a.id),
    balance: balances.get(a.id)!,
  }));
}

const numbersSchema = z
  .array(z.object({ last4: z.string().regex(/^\d{4}$/, "4 digits"), label: text(40).nullish() }))
  .max(10);

const accountSchema = z.object({
  name: text(60).min(1),
  institution: z.enum(INSTITUTIONS),
  kind: z.enum(ACCOUNT_KINDS),
  role: z.enum(ACCOUNT_ROLES).default("other"),
  numbers: numbersSchema.default([]),
  openingBalancePaise: signedPaise.default(0),
  openingBalanceAt: instant.nullish(),
  creditLimitPaise: paise.nullish(),
  statementDay: dayOfMonth.nullish(),
  dueDay: dayOfMonth.nullish(),
  fdLienPaise: paise.nullish(),
  archived: z.boolean().optional(),
});

const toRow = (body: Partial<z.infer<typeof accountSchema>>) => {
  const { numbers: _numbers, openingBalanceAt, ...rest } = body;
  return {
    ...rest,
    ...(openingBalanceAt !== undefined && { openingBalanceAt: openingBalanceAt ? new Date(openingBalanceAt) : null }),
  };
};

async function replaceNumbers(db: Db, accountId: number, numbers: z.infer<typeof numbersSchema>) {
  await db.delete(accountNumbers).where(eq(accountNumbers.accountId, accountId));
  const unique = [...new Map(numbers.map((n) => [n.last4, n])).values()];
  if (unique.length) {
    await db.insert(accountNumbers).values(unique.map((n) => ({ accountId, last4: n.last4, label: n.label ?? null })));
  }
}

export const accountRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listAccounts(c.var.db)))
  .post("/", zValidator("json", accountSchema), async (c) => {
    const body = c.req.valid("json");
    const db = c.var.db;
    const [row] = await db
      .insert(accounts)
      .values({ ...toRow(body), name: body.name, institution: body.institution, kind: body.kind })
      .returning();
    await replaceNumbers(db, row.id, body.numbers);
    const recovered = await reprocessUnparsed(db, true);
    return c.json({ id: row.id, recoveredSms: recovered }, 201);
  })
  .patch("/:id", idParam, zValidator("json", accountSchema.partial()), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = c.var.db;
    const updated = await db.update(accounts).set(toRow(body)).where(eq(accounts.id, id)).returning({ id: accounts.id });
    if (!updated.length) return c.json({ error: "not_found" }, 404);
    if (body.numbers) await replaceNumbers(db, id, body.numbers);
    // Only changes that affect SMS → account matching can recover parked SMS.
    const affectsMatching = body.numbers !== undefined || body.kind !== undefined || body.institution !== undefined || body.archived !== undefined;
    const recovered = affectsMatching ? await reprocessUnparsed(db, true) : 0;
    return c.json({ id, recoveredSms: recovered });
  })
  /** Manual correction: "the balance (or card outstanding) is X right now". */
  .post("/:id/balance", idParam, zValidator("json", z.object({ balancePaise: signedPaise })), async (c) => {
    const { id } = c.req.valid("param");
    const { balancePaise } = c.req.valid("json");
    const updated = await c.var.db
      .update(accounts)
      .set({ openingBalancePaise: balancePaise, openingBalanceAt: new Date() })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    return updated.length ? c.json({ id }) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.var.db;
    const used =
      (await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, id)).limit(1).get()) ??
      (await db.select({ id: autopays.id }).from(autopays).where(eq(autopays.accountId, id)).limit(1).get());
    if (used) {
      await db.update(accounts).set({ archived: true }).where(eq(accounts.id, id));
      return c.json({ archived: true });
    }
    await db.delete(accounts).where(eq(accounts.id, id));
    return c.json({ deleted: true });
  });
