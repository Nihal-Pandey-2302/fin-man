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
import { BACKUP_PREFIX, dumpTables, listBackups, runBackup, type BackupEnv } from "../backup";
import { findRecurring } from "../ledger/recurring";
import { buildSavings } from "../ledger/savings";
import { buildSalaryPlan } from "../ledger/salary-plan";
import { getSetting, getSettings, setSetting, type Settings } from "../ledger/settings";
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
    notify_new_txns: z.boolean(),
    dismissed_recurring: z.array(z.string().max(120)).max(500),
  })
  .partial();

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
  .get("/recurring", async (c) => c.json(await findRecurring(c.var.db)))
  /** "Not recurring": stop suggesting this merchant. */
  .post("/recurring/dismiss", zValidator("json", z.object({ key: z.string().min(1).max(120) })), async (c) => {
    const db = c.var.db;
    const current = await getSetting(db, "dismissed_recurring");
    const key = c.req.valid("json").key;
    if (!current.includes(key)) await setSetting(db, "dismissed_recurring", [...current, key].slice(-500));
    return c.json({ dismissed: key });
  })
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
  /** Automatic weekly backups (Workers KV), newest first; `configured: false` until the KV binding exists. */
  .get("/backups", async (c) => {
    const kv = (c.env as Env & BackupEnv).BACKUPS;
    return c.json({ configured: !!kv, backups: kv ? await listBackups(kv) : [] });
  })
  /** "Back up now" (e.g. before a big change); same as the weekly run, so today's copy is replaced. */
  .post("/backups/run", async (c) => {
    const kv = (c.env as Env & BackupEnv).BACKUPS;
    if (!kv) return c.json({ error: "not_configured" }, 503);
    return c.json(await runBackup(c.var.db, kv));
  })
  .get("/backups/:date", zValidator("param", z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })), async (c) => {
    const kv = (c.env as Env & BackupEnv).BACKUPS;
    const date = c.req.valid("param").date;
    const body = kv ? await kv.get(`${BACKUP_PREFIX}${date}`) : null;
    if (!body) return c.json({ error: "not_found" }, 404);
    c.header("Content-Disposition", `attachment; filename="fintrack-auto-${date}.json"`);
    c.header("Content-Type", "application/json");
    return c.body(body);
  })
  .get("/export", async (c) => {
    c.header("Content-Disposition", `attachment; filename="fintrack-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(await dumpTables(c.var.db, "download"));
  });
