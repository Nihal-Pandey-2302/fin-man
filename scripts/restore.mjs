#!/usr/bin/env node
// `npm run restore -- <backup.json>`            → replace the LOCAL D1's data with the backup's.
// `npm run restore -- <backup.json> --remote`   → the deployed D1 (asks you to type "restore" first).
// Works with files from `npm run backup`, Settings → Full backup, and the weekly automatic backups (v2).
// A safety backup of the current data is always taken first (backups/), so a restore can be undone.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { BACKUP_TABLES, checkBackup, restoreStatements } from "../shared/backup-sql.ts";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run restore -- <backup.json> [--remote]");
  process.exit(1);
}
const where = remote ? "--remote" : "--local";

const backup = checkBackup(JSON.parse(readFileSync(file, "utf8")));
const counts = BACKUP_TABLES.map((t) => [t, backup.tables[t]?.length ?? 0]);
console.log(`Backup from ${backup.exportedAt} (${backup.source}):`);
console.log("  " + counts.map(([t, n]) => `${t} ${n}`).join(" · "));
console.log(`This REPLACES all data in the ${remote ? "DEPLOYED (live)" : "local"} database.`);

if (remote) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "restore" to continue: ');
  rl.close();
  if (answer.trim() !== "restore") {
    console.log("Cancelled.");
    process.exit(1);
  }
}

console.log("Safety backup of the current data first…");
execFileSync("node", ["scripts/backup.mjs", ...(remote ? ["--remote"] : [])], { stdio: "inherit" });

const dir = mkdtempSync(join(tmpdir(), "fintrack-restore-"));
const sqlFile = join(dir, "restore.sql");
try {
  writeFileSync(sqlFile, restoreStatements(backup).join("\n") + "\n");
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", where, "--file", sqlFile, "--yes"], { stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Check every table has the backup's row count.
const raw = execFileSync("npx", ["wrangler", "d1", "execute", "DB", where, "--json", "--command", BACKUP_TABLES.map((t) => `SELECT COUNT(*) AS n FROM "${t}";`).join(" ")], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const results = JSON.parse(raw);
const wrong = counts.filter(([, n], i) => results[i]?.results?.[0]?.n !== n);
if (wrong.length) {
  console.error(`Row counts differ after restore: ${wrong.map(([t]) => t).join(", ")}. The safety backup above has the previous data.`);
  process.exit(1);
}
console.log("Restored. Every table matches the backup.");
