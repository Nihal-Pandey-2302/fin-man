// Backup files and how to restore them. Shared by the Worker (weekly backups, /api/export), the tests and the
// Node scripts (scripts/backup.mjs, scripts/restore.mjs run this file directly), so: no imports here.

/** v2: every table as raw SQL rows (snake_case columns, epoch-ms instants, 0/1 booleans), exactly as stored. */
export const BACKUP_FORMAT_VERSION = 2;

/**
 * Every table a restore needs, parents before children (restores insert in this order and delete in reverse).
 * Push subscriptions are left out: they belong to a device and re-register themselves.
 */
export const BACKUP_TABLES = [
  "accounts",
  "account_numbers",
  "categories",
  "merchant_rules",
  "sms_raw",
  "loans",
  "autopays",
  "transactions",
  "budget_cycles",
  "category_budgets",
  "holdings",
  "loan_payments",
  "quick_add_presets",
  "settings",
  "card_statements",
  "goals",
] as const;

export type BackupRow = Record<string, string | number | boolean | null>;
export type BackupFile = { app: "fintrack"; version: number; source: string; exportedAt: string; tables: Record<string, BackupRow[]> };

/** Check a parsed file is a restorable fintrack backup; throws a readable reason if not. */
export function checkBackup(data: unknown): BackupFile {
  const b = data as Partial<BackupFile> | null;
  if (!b || b.app !== "fintrack" || typeof b.tables !== "object" || b.tables === null) throw new Error("not a fintrack backup");
  if (b.version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`backup format v${b.version} can't be restored (needs v${BACKUP_FORMAT_VERSION}); take a fresh backup with npm run backup`);
  }
  const unknown = Object.keys(b.tables).filter((t) => !(BACKUP_TABLES as readonly string[]).includes(t));
  if (unknown.length) throw new Error(`unknown tables: ${unknown.join(", ")}`);
  for (const [t, rows] of Object.entries(b.tables)) {
    if (!Array.isArray(rows)) throw new Error(`${t} is not a list of rows`);
  }
  return b as BackupFile;
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unexpected column/table name: ${name}`);
  return `"${name}"`;
};

/** A literal that keeps every statement on one line (D1's exec and wrangler --file split on newlines). */
export function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`can't store ${v}`);
    return String(v);
  }
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const quoted = `'${s.replace(/'/g, "''")}'`;
  return quoted.replace(/\r/g, "' || char(13) || '").replace(/\n/g, "' || char(10) || '");
}

/**
 * SQL that replaces every table's contents with the backup's: deferred foreign keys, children deleted before
 * parents, parents inserted before children. A table missing from the backup ends up empty.
 */
export function restoreStatements(backup: BackupFile): string[] {
  const out = ["PRAGMA defer_foreign_keys = ON;"];
  for (const t of [...BACKUP_TABLES].reverse()) out.push(`DELETE FROM ${ident(t)};`);
  for (const t of BACKUP_TABLES) {
    for (const row of backup.tables[t] ?? []) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO ${ident(t)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((c) => sqlValue(row[c])).join(", ")});`);
    }
  }
  return out;
}
