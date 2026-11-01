import { BACKUP_FORMAT_VERSION, BACKUP_TABLES, type BackupFile, type BackupRow } from "../shared/backup-sql";
import { istDate } from "../shared/time";

/** Every table as raw SQL rows: the same file as `npm run backup`, restorable with `npm run restore`. */
export async function dumpTables(d1: D1Database, source: string, now = new Date()): Promise<BackupFile> {
  const results = await d1.batch<BackupRow>(BACKUP_TABLES.map((t) => d1.prepare(`SELECT * FROM "${t}"`)));
  const tables = Object.fromEntries(BACKUP_TABLES.map((t, i) => [t, results[i].results]));
  return { app: "fintrack", version: BACKUP_FORMAT_VERSION, source, exportedAt: now.toISOString(), tables };
}

/** Weekly automatic backups kept in Workers KV (separate from D1, free, no card needed). */
export type BackupEnv = { BACKUPS?: KVNamespace };
/** Must match the second cron in wrangler.jsonc. */
export const BACKUP_CRON = "0 21 * * 6";
export const BACKUP_PREFIX = "backup:";
export const BACKUPS_KEPT = 12;

export async function runBackup(d1: D1Database, kv: KVNamespace, now = new Date()) {
  const body = JSON.stringify(await dumpTables(d1, "auto", now));
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
