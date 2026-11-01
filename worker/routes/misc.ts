import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Bootstrap } from "../../shared/api";
import { toIstInput } from "../../shared/time";
import * as schema from "../db/schema";
import { buildAlerts } from "../ledger/alerts";
import { buildDashboard, reviewCount } from "../ledger/dashboard";
import { buildReport } from "../ledger/report";
import { buildSavings } from "../ledger/savings";
import { buildSalaryPlan } from "../ledger/salary-plan";
import { getSettings, setSetting, type Settings } from "../ledger/settings";
import type { AppEnv } from "../types";
import { listAccounts } from "./accounts";

const settingsSchema = z
  .object({
    owner_names: z.array(z.string().trim().min(2).max(60)).max(10),
    liquid_buffer_paise: z.number().int().min(0),
    autopay_buffer_paise: z.number().int().min(0),
    salary_employer: z.string().trim().max(80),
    salary_min_paise: z.number().int().min(0),
    savings_target_paise: z.number().int().min(0),
    savings_account_id: z.number().int().positive().nullable(),
  })
  .partial();

/** Every table, for `npm run backup` / the Settings download button. */
export const EXPORT_TABLES = {
  accounts: schema.accounts,
  account_numbers: schema.accountNumbers,
  categories: schema.categories,
  transactions: schema.transactions,
  sms_raw: schema.smsRaw,
  merchant_rules: schema.merchantRules,
  autopays: schema.autopays,
  budget_cycles: schema.budgetCycles,
  category_budgets: schema.categoryBudgets,
  holdings: schema.holdings,
  loans: schema.loans,
  loan_payments: schema.loanPayments,
  quick_add_presets: schema.quickAddPresets,
  settings: schema.settings,
  card_statements: schema.cardStatements,
  goals: schema.goals,
};

export const miscRoutes = new Hono<AppEnv>()
  /** The ingest secret, so the owner can copy it into MacroDroid from Settings (behind the login; never cached). */
  .get("/sms-forwarding", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ secret: c.env.INGEST_SECRET || null });
  })
  /** Everything the app shell needs in one round trip. */
  .get("/bootstrap", async (c) => {
    const db = c.var.db;
    const [accounts, categories, presets, settings, review] = await Promise.all([
      listAccounts(db),
      db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name)).all(),
      db.select().from(schema.quickAddPresets).where(eq(schema.quickAddPresets.active, true)).orderBy(asc(schema.quickAddPresets.sortOrder)).all(),
      getSettings(db),
      reviewCount(db),
    ]);
    return c.json({ accounts, categories, presets, settings, reviewCount: review } satisfies Bootstrap);
  })
  .get("/dashboard", async (c) => c.json(await buildDashboard(c.var.db)))
  .get("/alerts", async (c) => c.json(await buildAlerts(c.var.db)))
  .get("/salary-plan", async (c) => c.json(await buildSalaryPlan(c.var.db)))
  .get("/savings", async (c) => c.json(await buildSavings(c.var.db)))
  .get("/report", zValidator("query", z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })), async (c) =>
    c.json(await buildReport(c.var.db, c.req.valid("query").start)),
  )
  .get("/settings", async (c) => c.json(await getSettings(c.var.db)))
  .patch("/settings", zValidator("json", settingsSchema), async (c) => {
    const body = c.req.valid("json");
    for (const [key, value] of Object.entries(body) as [keyof Settings, Settings[keyof Settings]][]) {
      await setSetting(c.var.db, key, value as never);
    }
    return c.json(await getSettings(c.var.db));
  })
  /** Transactions as CSV (IST times, rupees with 2 decimals) for spreadsheets. */
  .get("/export.csv", async (c) => {
    const db = c.var.db;
    const [rows, accs, cats] = await Promise.all([
      db.select().from(schema.transactions).orderBy(asc(schema.transactions.occurredAt), asc(schema.transactions.id)).all(),
      db.select().from(schema.accounts).all(),
      db.select().from(schema.categories).all(),
    ]);
    const name = (list: { id: number; name: string }[], id: number | null) => list.find((x) => x.id === id)?.name ?? "";
    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rupees = (p: number) => `${p < 0 ? "-" : ""}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, "0")}`;
    const lines = [
      ["date_ist", "time_ist", "account", "direction", "amount_inr", "kind", "category", "merchant", "vpa", "ref_no", "note", "status", "source"].join(","),
      ...rows.map((t) => {
        const ist = toIstInput(t.occurredAt);
        return [ist.slice(0, 10), ist.slice(11), name(accs, t.accountId), t.direction, rupees(t.amountPaise), t.kind, name(cats, t.categoryId), t.merchant, t.counterpartyVpa, t.refNo, t.note, t.status, t.source]
          .map(cell)
          .join(",");
      }),
    ];
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="fintrack-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(`\uFEFF${lines.join("\r\n")}\r\n`);
  })
  .get("/export", async (c) => {
    const db = c.var.db;
    const entries = await Promise.all(Object.entries(EXPORT_TABLES).map(async ([name, table]) => [name, await db.select().from(table).all()] as const));
    c.header("Content-Disposition", `attachment; filename="fintrack-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ app: "fintrack", version: 1, exportedAt: new Date().toISOString(), tables: Object.fromEntries(entries) });
  });
