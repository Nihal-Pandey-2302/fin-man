import { istDate } from "../shared/time";
import type { Db } from "./db";
import * as schema from "./db/schema";

/** Every table that a restore needs (push subscriptions are per-device and re-register themselves). */
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

/** The same JSON as `npm run backup` and the Settings download. */
export async function dumpTables(db: Db, source: string, now = new Date()) {
  const entries = await Promise.all(Object.entries(EXPORT_TABLES).map(async ([name, table]) => [name, await db.select().from(table).all()] as const));
  return { app: "fintrack", version: 1, source, exportedAt: now.toISOString(), tables: Object.fromEntries(entries) };
}

/** Weekly automatic backups kept in Workers KV (separate from D1, free, no card needed). */
export type BackupEnv = { BACKUPS?: KVNamespace };
/** Must match the second cron in wrangler.jsonc. */
export const BACKUP_CRON = "0 21 * * 6";
export const BACKUP_PREFIX = "backup:";
export const BACKUPS_KEPT = 12;

export async function runBackup(db: Db, kv: KVNamespace, now = new Date()) {
  const body = JSON.stringify(await dumpTables(db, "auto", now));
  const key = `${BACKUP_PREFIX}${istDate(now)}`;
  await kv.put(key, body, { metadata: { bytes: body.length, exportedAt: now.toISOString() } });
  const { keys } = await kv.list({ prefix: BACKUP_PREFIX });
  // Keys sort by date (YYYY-MM-DD): keep the newest few.
  const old = keys.map((k) => k.name).sort().reverse().slice(BACKUPS_KEPT);
  await Promise.all(old.map((k) => kv.delete(k)));
  return { key, bytes: body.length, pruned: old.length };
}

export async function listBackups(kv: KVNamespace) {
  const { keys } = await kv.list<{ bytes: number; exportedAt: string }>({ prefix: BACKUP_PREFIX });
  return keys
    .map((k) => ({ date: k.name.slice(BACKUP_PREFIX.length), bytes: k.metadata?.bytes ?? null, exportedAt: k.metadata?.exportedAt ?? null }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
