// Every table must be in the backups (Settings download, /api/export, `npm run backup`), or a restore loses data.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BACKUP_CRON, BACKUP_PREFIX, BACKUPS_KEPT, EXPORT_TABLES, runBackup } from "../worker/backup";
import wranglerConfig from "../wrangler.jsonc?raw";
import { api, db, seedAccounts } from "./helpers";
import backupScript from "../scripts/backup.mjs?raw";

// Device-bound browser push endpoints are useless in a restore (they re-register on each device).
const NOT_BACKED_UP = new Set(["push_subscriptions"]);

it("backs up every table", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();
  const tables = results.map((r) => r.name).filter((t) => !NOT_BACKED_UP.has(t));
  expect(tables.length).toBeGreaterThan(10);
  for (const t of tables) {
    expect(Object.keys(EXPORT_TABLES), `/api/export misses ${t}`).toContain(t);
    expect(backupScript, `scripts/backup.mjs misses ${t}`).toContain(`"${t}"`);
  }
});

describe("weekly automatic backups", () => {
  const kv = () => (env as unknown as { BACKUPS: KVNamespace }).BACKUPS;

  it("stores every table in KV and keeps the newest 12", async () => {
    await seedAccounts();
    for (let i = 1; i <= 14; i++) await kv().put(`${BACKUP_PREFIX}2026-0${Math.ceil(i / 4)}-${String(i).padStart(2, "0")}`, "{}");
    const out = await runBackup(db, kv(), new Date("2026-11-08T21:00:00Z"));
    expect(out.key).toBe(`${BACKUP_PREFIX}2026-11-09`);
    const { keys } = await kv().list({ prefix: BACKUP_PREFIX });
    expect(keys).toHaveLength(BACKUPS_KEPT);
    expect(keys.map((k) => k.name)).toContain(out.key);

    const saved = JSON.parse((await kv().get(out.key))!);
    expect(Object.keys(saved.tables).sort()).toEqual(Object.keys(EXPORT_TABLES).sort());
    expect(saved.tables.accounts).toHaveLength(5);
    expect(saved).toMatchObject({ app: "fintrack", source: "auto" });
  });

  it("lists and downloads backups behind the login", async () => {
    await runBackup(db, kv(), new Date("2026-11-15T21:00:00Z"));
    const list = (await (await api("/backups")).json()) as { configured: boolean; backups: { date: string; bytes: number }[] };
    expect(list.configured).toBe(true);
    expect(list.backups[0].date).toBe("2026-11-16");
    expect(list.backups[0].bytes).toBeGreaterThan(100);
    const res = await api("/backups/2026-11-16");
    expect(res.headers.get("content-disposition")).toContain("fintrack-auto-2026-11-16.json");
    expect((await res.json()) as object).toHaveProperty("tables");
    expect((await api("/backups/2020-01-01")).status).toBe(404);
    expect((await api("/backups", { auth: false })).status).toBe(401);
    // Back up now.
    const run = (await (await api("/backups/run", { method: "POST" })).json()) as { key: string };
    expect(run.key).toMatch(/^backup:\d{4}-\d{2}-\d{2}$/);
    expect((await api("/backups/run", { method: "POST", auth: false })).status).toBe(401);
  });

  it("runs on the cron that wrangler.jsonc schedules", () => {
    expect(wranglerConfig).toContain(`"${BACKUP_CRON}"`);
  });
});
