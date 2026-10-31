import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { categories, categoryBudgets, merchantRules, RULE_MATCH_TYPES, transactions, TXN_KINDS } from "../db/schema";
import { findRule } from "../ledger/rules";
import type { AppEnv } from "../types";
import { id, idParam, text } from "./validators";

const categorySchema = z.object({
  name: text(40).min(1),
  emoji: text(8).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  parentId: id.nullish(),
  isEssential: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
});

export const categoryRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await c.var.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all()))
  .post("/", zValidator("json", categorySchema), async (c) => {
    const [row] = await c.var.db.insert(categories).values(c.req.valid("json")).returning();
    return c.json(row, 201);
  })
  .patch("/:id", idParam, zValidator("json", categorySchema.partial()), async (c) => {
    const [row] = await c.var.db.update(categories).set(c.req.valid("json")).where(eq(categories.id, c.req.valid("param").id)).returning();
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.var.db;
    const used =
      (await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.categoryId, id)).limit(1).get()) ??
      (await db.select({ id: categoryBudgets.categoryId }).from(categoryBudgets).where(eq(categoryBudgets.categoryId, id)).limit(1).get());
    if (used) {
      await db.update(categories).set({ archived: true }).where(eq(categories.id, id));
      return c.json({ archived: true });
    }
    await db.delete(categories).where(eq(categories.id, id));
    return c.json({ deleted: true });
  });

const ruleSchema = z
  .object({
    match: text(120).min(2),
    matchType: z.enum(RULE_MATCH_TYPES).default("substring"),
    categoryId: id.nullish(),
    kindOverride: z.enum(TXN_KINDS).nullish(),
  })
  .refine((r) => r.matchType !== "regex" || isValidRegex(r.match), { message: "invalid regex", path: ["match"] });

function isValidRegex(s: string) {
  try {
    new RegExp(s, "i");
    return true;
  } catch {
    return false;
  }
}

export const ruleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await c.var.db.select().from(merchantRules).orderBy(desc(merchantRules.hits), asc(merchantRules.match)).all()))
  .post("/", zValidator("json", ruleSchema), async (c) => {
    const body = c.req.valid("json");
    const [row] = await c.var.db
      .insert(merchantRules)
      .values({ ...body, match: body.matchType === "substring" ? body.match.toLowerCase() : body.match })
      .onConflictDoUpdate({
        target: [merchantRules.matchType, merchantRules.match],
        set: { categoryId: body.categoryId ?? null, kindOverride: body.kindOverride ?? null, updatedAt: new Date() },
      })
      .returning();
    return c.json(row, 201);
  })
  .patch("/:id", idParam, zValidator("json", z.object({ match: text(120).min(2).optional(), categoryId: id.nullish(), kindOverride: z.enum(TXN_KINDS).nullish() })), async (c) => {
    const [row] = await c.var.db.update(merchantRules).set(c.req.valid("json")).where(eq(merchantRules.id, c.req.valid("param").id)).returning();
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    await c.var.db.delete(merchantRules).where(eq(merchantRules.id, c.req.valid("param").id));
    return c.json({ deleted: true });
  })
  /** Apply a rule to every uncategorised transaction it matches. */
  .post("/:id/apply", idParam, async (c) => {
    const db = c.var.db;
    const rule = await db.select().from(merchantRules).where(eq(merchantRules.id, c.req.valid("param").id)).get();
    if (!rule) return c.json({ error: "not_found" }, 404);
    const applied = await applyRule(db, rule);
    return c.json({ applied });
  });

/** Categorise uncategorised, unpaired transactions that `rule` matches. Returns how many changed. */
export async function applyRule(db: AppEnv["Variables"]["db"], rule: typeof merchantRules.$inferSelect): Promise<number> {
  const candidates = await db
    .select({ id: transactions.id, merchant: transactions.merchant, vpa: transactions.counterpartyVpa, kind: transactions.kind })
    .from(transactions)
    .where(and(isNull(transactions.categoryId), isNull(transactions.transferGroupId)))
    .all();
  let applied = 0;
  for (const t of candidates) {
    if (!findRule([rule], t.merchant, t.vpa)) continue;
    await db
      .update(transactions)
      .set({ categoryId: rule.categoryId, kind: rule.kindOverride ?? t.kind, status: "confirmed" })
      .where(eq(transactions.id, t.id));
    applied++;
  }
  return applied;
}
