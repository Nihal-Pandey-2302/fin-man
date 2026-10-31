import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { addDays, addMonths, istDate, nextDayOfMonth } from "../../shared/time";
import type { Db } from "../db";
import {
  AUTOPAY_KINDS,
  autopays,
  budgetCycles,
  categoryBudgets,
  FREQUENCIES,
  HOLDING_TYPES,
  holdings,
  LOAN_DIRECTIONS,
  loanPayments,
  loans,
  quickAddPresets,
} from "../db/schema";
import { currentCycle } from "../ledger/cycles";
import type { AppEnv } from "../types";
import { date, dayOfMonth, id, idParam, paise, text } from "./validators";

// ---------------- budget cycles ----------------
const cycleSchema = z.object({
  startDate: date,
  plannedSpendPaise: z.number().int().min(0),
  incomePaise: z.number().int().min(0).optional(),
  salaryTxnId: id.nullish(),
});

/** Start (or update) the cycle beginning on `startDate`; the previous open cycle ends the day before. */
export async function startCycle(db: Db, body: z.infer<typeof cycleSchema>) {
  const [row] = await db
    .insert(budgetCycles)
    .values(body)
    .onConflictDoUpdate({
      target: budgetCycles.startDate,
      set: {
        plannedSpendPaise: body.plannedSpendPaise,
        ...(body.incomePaise !== undefined && { incomePaise: body.incomePaise }),
        ...(body.salaryTxnId !== undefined && { salaryTxnId: body.salaryTxnId }),
      },
    })
    .returning();
  const dayBefore = addDays(body.startDate, -1);
  await db
    .update(budgetCycles)
    .set({ endDate: dayBefore })
    .where(and(lt(budgetCycles.startDate, body.startDate), or(isNull(budgetCycles.endDate), sql`${budgetCycles.endDate} > ${dayBefore}`)));
  return row;
}

export const cycleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.var.db;
    const [rows, budgets] = await Promise.all([
      db.select().from(budgetCycles).orderBy(desc(budgetCycles.startDate)).limit(24).all(),
      db.select().from(categoryBudgets).all(),
    ]);
    return c.json(rows.map((r) => ({ ...r, budgets: budgets.filter((b) => b.cycleId === r.id) })));
  })
  .get("/current", async (c) => {
    const cycle = await currentCycle(c.var.db);
    const budgets = cycle.id
      ? await c.var.db.select().from(categoryBudgets).where(eq(categoryBudgets.cycleId, cycle.id)).all()
      : [];
    return c.json({ ...cycle, budgets });
  })
  .post("/", zValidator("json", cycleSchema), async (c) => c.json(await startCycle(c.var.db, c.req.valid("json")), 201))
  .patch(
    "/:id",
    idParam,
    zValidator("json", z.object({ plannedSpendPaise: z.number().int().min(0).optional(), incomePaise: z.number().int().min(0).optional(), endDate: date.nullable().optional() })),
    async (c) => {
      const [row] = await c.var.db.update(budgetCycles).set(c.req.valid("json")).where(eq(budgetCycles.id, c.req.valid("param").id)).returning();
      return row ? c.json(row) : c.json({ error: "not_found" }, 404);
    },
  )
  .put(
    "/:id/budgets",
    idParam,
    zValidator("json", z.object({ budgets: z.array(z.object({ categoryId: id, limitPaise: z.number().int().min(0) })).max(100) })),
    async (c) => {
      const { id: cycleId } = c.req.valid("param");
      const { budgets } = c.req.valid("json");
      const db = c.var.db;
      await db.delete(categoryBudgets).where(eq(categoryBudgets.cycleId, cycleId));
      const rows = budgets.filter((b) => b.limitPaise > 0).map((b) => ({ ...b, cycleId }));
      if (rows.length) await db.insert(categoryBudgets).values(rows);
      return c.json({ saved: rows.length });
    },
  );

// ---------------- autopays ----------------
const autopaySchema = z.object({
  name: text(80).min(1),
  kind: z.enum(AUTOPAY_KINDS),
  accountId: id,
  categoryId: id.nullish(),
  amountPaise: paise,
  frequency: z.enum(FREQUENCIES).default("monthly"),
  dayOfMonth,
  nextDueOn: date.optional(),
  active: z.boolean().optional(),
  matchHint: text(80).nullish(),
});

const MONTHS_PER = { monthly: 1, quarterly: 3, yearly: 12 } as const;

/** Move an autopay's due date one period forward (after it's been paid). */
export async function advanceAutopay(db: Db, autopayId: number) {
  const a = await db.select().from(autopays).where(eq(autopays.id, autopayId)).get();
  if (!a) return null;
  const nextDueOn = addMonths(a.nextDueOn, MONTHS_PER[a.frequency], a.dayOfMonth);
  const [row] = await db.update(autopays).set({ nextDueOn }).where(eq(autopays.id, autopayId)).returning();
  return row;
}

export const autopayRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await c.var.db.select().from(autopays).orderBy(desc(autopays.active), asc(autopays.nextDueOn)).all()))
  .post("/", zValidator("json", autopaySchema), async (c) => {
    const body = c.req.valid("json");
    const [row] = await c.var.db
      .insert(autopays)
      .values({ ...body, nextDueOn: body.nextDueOn ?? nextDayOfMonth(istDate(), body.dayOfMonth) })
      .returning();
    return c.json(row, 201);
  })
  .patch("/:id", idParam, zValidator("json", autopaySchema.partial()), async (c) => {
    const body = c.req.valid("json");
    const nextDueOn = body.nextDueOn ?? (body.dayOfMonth ? nextDayOfMonth(istDate(), body.dayOfMonth) : undefined);
    const [row] = await c.var.db
      .update(autopays)
      .set({ ...body, ...(nextDueOn && { nextDueOn }) })
      .where(eq(autopays.id, c.req.valid("param").id))
      .returning();
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .post("/:id/paid", idParam, async (c) => {
    const row = await advanceAutopay(c.var.db, c.req.valid("param").id);
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    await c.var.db.delete(autopays).where(eq(autopays.id, c.req.valid("param").id));
    return c.json({ deleted: true });
  });

// ---------------- quick-add presets ----------------
const presetSchema = z.object({
  name: text(40).min(1),
  categoryId: id.nullish(),
  accountId: id.nullish(),
  amountPaise: paise.nullish(),
  note: text(200).nullish(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const presetRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await c.var.db.select().from(quickAddPresets).orderBy(asc(quickAddPresets.sortOrder), asc(quickAddPresets.id)).all()))
  .post("/", zValidator("json", presetSchema), async (c) => c.json((await c.var.db.insert(quickAddPresets).values(c.req.valid("json")).returning())[0], 201))
  .patch("/:id", idParam, zValidator("json", presetSchema.partial()), async (c) => {
    const [row] = await c.var.db.update(quickAddPresets).set(c.req.valid("json")).where(eq(quickAddPresets.id, c.req.valid("param").id)).returning();
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    await c.var.db.delete(quickAddPresets).where(eq(quickAddPresets.id, c.req.valid("param").id));
    return c.json({ deleted: true });
  });

// ---------------- loans / IOUs ----------------
const loanSchema = z.object({
  person: text(80).min(1),
  direction: z.enum(LOAN_DIRECTIONS),
  principalPaise: paise,
  reason: text(200).nullish(),
  openedOn: date,
  dueOn: date.nullish(),
  note: text(500).nullish(),
});

async function refreshLoanStatus(db: Db, loanId: number) {
  const loan = await db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return;
  const [{ paid }] = await db
    .select({ paid: sql<number>`COALESCE(SUM(${loanPayments.amountPaise}), 0)` })
    .from(loanPayments)
    .where(eq(loanPayments.loanId, loanId));
  const status = paid >= loan.principalPaise ? "settled" : paid > 0 ? "partially_paid" : "open";
  if (status !== loan.status) await db.update(loans).set({ status }).where(eq(loans.id, loanId));
}

export const loanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.var.db;
    const [rows, payments] = await Promise.all([
      db.select().from(loans).orderBy(asc(sql`${loans.status} = 'settled'`), desc(loans.openedOn)).all(),
      db.select().from(loanPayments).orderBy(desc(loanPayments.paidOn)).all(),
    ]);
    return c.json(
      rows.map((l) => {
        const mine = payments.filter((p) => p.loanId === l.id);
        return { ...l, payments: mine, paidPaise: mine.reduce((s, p) => s + p.amountPaise, 0) };
      }),
    );
  })
  .post("/", zValidator("json", loanSchema), async (c) => c.json((await c.var.db.insert(loans).values(c.req.valid("json")).returning())[0], 201))
  .patch("/:id", idParam, zValidator("json", loanSchema.partial()), async (c) => {
    const { id: loanId } = c.req.valid("param");
    const [row] = await c.var.db.update(loans).set(c.req.valid("json")).where(eq(loans.id, loanId)).returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    await refreshLoanStatus(c.var.db, loanId);
    return c.json(row);
  })
  .delete("/:id", idParam, async (c) => {
    await c.var.db.delete(loans).where(eq(loans.id, c.req.valid("param").id));
    return c.json({ deleted: true });
  })
  .post(
    "/:id/payments",
    idParam,
    zValidator("json", z.object({ amountPaise: paise, paidOn: date, note: text(200).nullish(), transactionId: id.nullish() })),
    async (c) => {
      const { id: loanId } = c.req.valid("param");
      const [row] = await c.var.db.insert(loanPayments).values({ ...c.req.valid("json"), loanId }).returning();
      await refreshLoanStatus(c.var.db, loanId);
      return c.json(row, 201);
    },
  )
  .delete("/payments/:id", idParam, async (c) => {
    const [row] = await c.var.db.delete(loanPayments).where(eq(loanPayments.id, c.req.valid("param").id)).returning();
    if (row) await refreshLoanStatus(c.var.db, row.loanId);
    return c.json({ deleted: true });
  });

// ---------------- holdings (manual) ----------------
const holdingSchema = z.object({
  name: text(80).min(1),
  type: z.enum(HOLDING_TYPES),
  platform: text(40).nullish(),
  investedPaise: z.number().int().min(0),
  currentValuePaise: z.number().int().min(0).nullish(),
});

export const holdingRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await c.var.db.select().from(holdings).orderBy(asc(holdings.type), asc(holdings.name)).all()))
  .post("/", zValidator("json", holdingSchema), async (c) => c.json((await c.var.db.insert(holdings).values(c.req.valid("json")).returning())[0], 201))
  .patch("/:id", idParam, zValidator("json", holdingSchema.partial()), async (c) => {
    const [row] = await c.var.db.update(holdings).set(c.req.valid("json")).where(eq(holdings.id, c.req.valid("param").id)).returning();
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  })
  .delete("/:id", idParam, async (c) => {
    await c.var.db.delete(holdings).where(eq(holdings.id, c.req.valid("param").id));
    return c.json({ deleted: true });
  });

