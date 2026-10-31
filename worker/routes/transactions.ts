import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { rupeesToPaise } from "../../shared/money";
import { addDays, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { accounts, DIRECTIONS, INCOME_SOURCES, smsRaw, transactions, TXN_KINDS, TXN_STATUSES } from "../db/schema";
import { unpairGroup } from "../ledger/matcher";
import { detectSalary } from "../ledger/salary";
import { settleNewTransaction } from "../ledger/settle";
import { applyRuleToUncategorized, learnRule } from "../ledger/rules";
import { processSms } from "../sms/ingest";
import type { AppEnv } from "../types";
import { date, id, idParam, instant, paise, text } from "./validators";

type Txn = typeof transactions.$inferSelect;

const listQuery = z.object({
  q: text(80).optional(),
  accountId: id.optional(),
  categoryId: z.union([id, z.literal("none")]).optional(),
  kind: z.enum(TXN_KINDS).optional(),
  status: z.enum(TXN_STATUSES).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  from: date.optional(),
  to: date.optional(),
  cursor: z.string().regex(/^\d+_\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const createSchema = z
  .object({
    accountId: id,
    amountPaise: paise,
    direction: z.enum(DIRECTIONS),
    kind: z.enum(TXN_KINDS),
    categoryId: id.nullish(),
    merchant: text(120).nullish(),
    note: text(500).nullish(),
    occurredAt: instant.optional(),
    incomeSource: z.enum(INCOME_SOURCES).nullish(),
    /** Create from an unparsed SMS in the review inbox. */
    smsId: id.optional(),
  })
  .refine((t) => !t.incomeSource || t.kind === "income", { message: "incomeSource needs kind=income", path: ["incomeSource"] });

const patchSchema = z.object({
  accountId: id.optional(),
  amountPaise: paise.optional(),
  direction: z.enum(DIRECTIONS).optional(),
  kind: z.enum(TXN_KINDS).optional(),
  categoryId: id.nullable().optional(),
  merchant: text(120).nullable().optional(),
  note: text(500).nullable().optional(),
  occurredAt: instant.optional(),
  incomeSource: z.enum(INCOME_SOURCES).nullable().optional(),
  status: z.enum(TXN_STATUSES).optional(),
  /** Remember the category for this merchant (default) and apply it to similar items in the inbox. */
  learn: z.boolean().default(true),
});
type Patch = z.infer<typeof patchSchema>;

/** Kinds a merchant rule may force (plain expense/income are the defaults, not overrides). */
const OVERRIDE_KINDS = new Set<Txn["kind"]>(["investment", "fee", "interest", "refund"]);

/** Apply an edit; editing implies the owner has looked at it, so it becomes confirmed. */
export async function updateTxn(db: Db, txnId: number, patch: Patch) {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t) return null;
  const { learn, occurredAt, ...fields } = patch;
  const kind = fields.kind ?? t.kind;

  // A paired leg whose kind, amount, direction or account changes no longer balances its counterpart:
  // unpair both (the other leg goes back to the review inbox).
  const breaksPair =
    (fields.kind !== undefined && fields.kind !== "transfer" && fields.kind !== "card_payment") ||
    (fields.amountPaise !== undefined && fields.amountPaise !== t.amountPaise) ||
    (fields.direction !== undefined && fields.direction !== t.direction) ||
    (fields.accountId !== undefined && fields.accountId !== t.accountId);
  if (t.transferGroupId && breaksPair) await unpairGroup(db, t.transferGroupId);

  const [row] = await db
    .update(transactions)
    .set({
      ...fields,
      ...(occurredAt && { occurredAt: new Date(occurredAt) }),
      ...(kind !== "income" && { incomeSource: null }),

      status: fields.status ?? "confirmed",
    })
    .where(eq(transactions.id, txnId))
    .returning();

  let ruleId: number | null = null;
  let appliedTo = 0;
  const merchant = fields.merchant !== undefined ? fields.merchant : t.merchant;
  if (learn && fields.categoryId !== undefined && fields.categoryId !== null && kind !== "transfer" && kind !== "card_payment") {
    const rule = await learnRule(db, merchant, fields.categoryId, OVERRIDE_KINDS.has(kind) ? kind : null);
    if (rule) {
      ruleId = rule.id;
      // Same merchant still waiting in the inbox → categorise those too.
      appliedTo = await applyRuleToUncategorized(db, rule, { onlyNeedsReview: true, excludeId: txnId });
    }
  }
  // Marking a credit as salary starts the new budget cycle.
  if (fields.incomeSource === "salary" && t.incomeSource !== "salary") await detectSalary(db, txnId);
  return { txn: row, ruleId, appliedTo };
}

export const transactionRoutes = new Hono<AppEnv>()
  .get("/", zValidator("query", listQuery), async (c) => {
    const q = c.req.valid("query");
    const where: (SQL | undefined)[] = [];
    if (q.accountId) where.push(eq(transactions.accountId, q.accountId));
    if (q.categoryId === "none") where.push(isNull(transactions.categoryId));
    else if (q.categoryId) where.push(eq(transactions.categoryId, q.categoryId));
    if (q.kind) where.push(eq(transactions.kind, q.kind));
    if (q.status) where.push(eq(transactions.status, q.status));
    if (q.direction) where.push(eq(transactions.direction, q.direction));
    if (q.from) where.push(gte(transactions.occurredAt, istDayStart(q.from)));
    if (q.to) where.push(lt(transactions.occurredAt, istDayStart(addDays(q.to, 1))));
    if (q.q) {
      const pattern = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
      const amount = rupeesToPaise(q.q);
      where.push(
        or(
          sql`${transactions.merchant} LIKE ${pattern} ESCAPE '\\'`,
          sql`${transactions.note} LIKE ${pattern} ESCAPE '\\'`,
          sql`${transactions.counterpartyVpa} LIKE ${pattern} ESCAPE '\\'`,
          amount !== null ? eq(transactions.amountPaise, amount) : undefined,
        ),
      );
    }
    if (q.cursor) {
      const [ms, cid] = q.cursor.split("_").map(Number);
      where.push(
        or(lt(transactions.occurredAt, new Date(ms)), and(eq(transactions.occurredAt, new Date(ms)), lt(transactions.id, cid))),
      );
    }
    const rows = await c.var.db
      .select()
      .from(transactions)
      .where(and(...where))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(q.limit + 1)
      .all();
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    return c.json({
      items,
      nextCursor: rows.length > q.limit && last ? `${last.occurredAt.getTime()}_${last.id}` : null,
    });
  })
  .get("/:id", idParam, async (c) => {
    const row = await c.var.db.select().from(transactions).where(eq(transactions.id, c.req.valid("param").id)).get();
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .post("/", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const db = c.var.db;
    const { smsId, occurredAt, ...fields } = body;
    let sms: typeof smsRaw.$inferSelect | undefined;
    if (smsId) {
      sms = await db.select().from(smsRaw).where(eq(smsRaw.id, smsId)).get();
      if (!sms) return c.json({ error: "sms_not_found" }, 404);
    }
    const [row] = await db
      .insert(transactions)
      .values({
        ...fields,
        occurredAt: occurredAt ? new Date(occurredAt) : (sms?.receivedAt ?? new Date()),
        source: sms ? "sms" : "manual",
        smsId: sms?.id ?? null,
        status: "confirmed",
      })
      .onConflictDoNothing({ target: transactions.smsId })
      .returning();
    if (!row) return c.json({ error: "sms_already_has_transaction" }, 409);
    if (sms) await db.update(smsRaw).set({ parseStatus: "parsed", parser: "manual", error: null }).where(eq(smsRaw.id, sms.id));
    if (fields.categoryId && fields.merchant && fields.kind !== "transfer" && fields.kind !== "card_payment") {
      await learnRule(db, fields.merchant, fields.categoryId, OVERRIDE_KINDS.has(fields.kind) ? fields.kind : null);
    }
    await settleNewTransaction(db, row.id);
    return c.json(row, 201);
  })
  .patch("/:id", idParam, zValidator("json", patchSchema), async (c) => {
    const result = await updateTxn(c.var.db, c.req.valid("param").id, c.req.valid("json"));
    return result ? c.json(result) : c.json({ error: "not_found" }, 404);
  })
  /** Swipe-to-confirm from the review inbox (optionally with the picked category). */
  .post("/:id/confirm", idParam, zValidator("json", z.object({ categoryId: id.nullish() }).default({})), async (c) => {
    const { categoryId } = c.req.valid("json");
    const result = await updateTxn(c.var.db, c.req.valid("param").id, {
      status: "confirmed",
      learn: true,
      ...(categoryId !== undefined && { categoryId }),
    });
    return result ? c.json(result) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    const db = c.var.db;
    const t = await db.select().from(transactions).where(eq(transactions.id, c.req.valid("param").id)).get();
    if (!t) return c.json({ error: "not_found" }, 404);
    if (t.transferGroupId) await unpairGroup(db, t.transferGroupId);
    await db.delete(transactions).where(eq(transactions.id, t.id));
    // Keep the SMS but make sure a reprocess can't resurrect the deleted transaction.
    if (t.smsId) await db.update(smsRaw).set({ parseStatus: "ignored", error: "deleted_by_user" }).where(eq(smsRaw.id, t.smsId));
    return c.json({ deleted: true });
  });

const transferSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amountPaise: paise,
    occurredAt: instant.optional(),
    note: text(500).nullish(),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, { message: "accounts must differ", path: ["toAccountId"] });

export const transferRoutes = new Hono<AppEnv>()
  /** Manual transfer between own accounts (e.g. ATM cash → Cash), or a card bill payment. */
  .post("/", zValidator("json", transferSchema), async (c) => {
    const body = c.req.valid("json");
    const db = c.var.db;
    const accs = await db.select().from(accounts).where(inArray(accounts.id, [body.fromAccountId, body.toAccountId])).all();
    if (accs.length !== 2) return c.json({ error: "account_not_found" }, 404);
    const to = accs.find((a) => a.id === body.toAccountId)!;
    const kind = to.kind === "credit_card" ? "card_payment" : "transfer";
    const groupId = crypto.randomUUID();
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const base = { amountPaise: body.amountPaise, kind, occurredAt, note: body.note ?? null, source: "manual", transferGroupId: groupId, status: "confirmed" } as const;
    const rows = await db
      .insert(transactions)
      .values([
        { ...base, accountId: body.fromAccountId, direction: "debit" },
        { ...base, accountId: body.toAccountId, direction: "credit" },
      ])
      .returning();
    return c.json({ groupId, transactions: rows }, 201);
  })
  .post("/:groupId/unpair", zValidator("param", z.object({ groupId: z.uuid() })), async (c) => {
    await unpairGroup(c.var.db, c.req.valid("param").groupId);
    return c.json({ unpaired: true });
  });

export const reviewRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.var.db;
    const [txns, sms] = await Promise.all([
      db.select().from(transactions).where(eq(transactions.status, "needs_review")).orderBy(desc(transactions.occurredAt)).limit(200).all(),
      db.select().from(smsRaw).where(inArray(smsRaw.parseStatus, ["unparsed", "error"])).orderBy(desc(smsRaw.receivedAt)).limit(100).all(),
    ]);
    return c.json({ transactions: txns, sms });
  })
  .post("/sms/:id/reprocess", idParam, async (c) => {
    const db = c.var.db;
    const row = await db.select().from(smsRaw).where(eq(smsRaw.id, c.req.valid("param").id)).get();
    if (!row) return c.json({ error: "not_found" }, 404);
    // Only parked SMS are retried: a parsed one already has its transaction, an ignored one was
    // dismissed (or its transaction deleted) on purpose.
    if (row.parseStatus === "parsed") return c.json({ status: "duplicate", smsId: row.id });
    if (row.parseStatus === "ignored") return c.json({ status: "ignored", smsId: row.id, reason: row.error });
    return c.json(await processSms(db, row));
  })
  .post("/sms/:id/dismiss", idParam, async (c) => {
    await c.var.db.update(smsRaw).set({ parseStatus: "ignored", error: "dismissed" }).where(eq(smsRaw.id, c.req.valid("param").id));
    return c.json({ dismissed: true });
  });

