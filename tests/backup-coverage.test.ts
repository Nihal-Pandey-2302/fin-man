// Backups: every table is in them, the weekly KV copies work, and a restore brings the data back exactly.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, checkBackup, restoreStatements, sqlValue } from "../shared/backup-sql";
import { BACKUP_CRON, BACKUP_PREFIX, BACKUPS_KEPT, dumpTables, runBackup } from "../worker/backup";
import backupScript from "../scripts/backup.mjs?raw";
import wranglerConfig from "../wrangler.jsonc?raw";
import { api, db, fixture, postSms, schema, seedAccounts } from "./helpers";

// Device-bound browser push endpoints are useless in a restore (they re-register on each device).
const NOT_BACKED_UP = new Set(["push_subscriptions"]);
const kv = () => env.BACKUPS;

it("backs up every table", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();
  const tables = results.map((r) => r.name).filter((t) => !NOT_BACKED_UP.has(t));
  expect(tables.length).toBeGreaterThan(10);
  expect([...BACKUP_TABLES].sort()).toEqual(tables.sort());
  // npm run backup uses the same list.
  expect(backupScript).toContain('from "../shared/backup-sql.ts"');
});

describe("restore", () => {
  it("writes SQL that keeps every statement on one line, whatever the text", () => {
    expect(sqlValue(null)).toBe("NULL");
    expect(sqlValue(true)).toBe("1");
    expect(sqlValue(1_793_000_000_000)).toBe("1793000000000");
    expect(sqlValue("it's")).toBe("'it''s'");
    expect(sqlValue("Sent Rs.5\nFrom HDFC")).toBe("'Sent Rs.5' || char(10) || 'From HDFC'");
    expect(() => checkBackup({ app: "fintrack", version: 1, tables: {} })).toThrow(/v1 can't be restored/);
    expect(() => checkBackup({ app: "fintrack", version: 2, tables: { nope: [] } })).toThrow(/unknown tables/);
  });

  it("round-trips the whole database: backup, wreck it, restore, identical", async () => {
    const { hdfc, card } = await seedAccounts();
    await postSms("JK-HDFCBK-S", fixture("hdfc/upi_debit.txt")); // multi-line body
    await postSms("JD-IDFCFB-S", fixture("card/spend_rupay_swiggy.txt"));
    await api("/transfers", { method: "POST", json: { fromAccountId: hdfc.id, toAccountId: card.id, amountPaise: 38_000 } });
    await api("/settings", { method: "PATCH", json: { owner_names: [`O'Brien "Nihal"`], savings_target_paise: 1_000_000 } });
    await api("/goals", { method: "POST", json: { name: "Trip", targetPaise: 3_000_000, dueOn: "2027-03-01" } });
    await api(`/cards/${card.id}/statement`, { method: "PUT", json: { statementDate: "2026-10-20", amountPaise: 123_456 } });

    const before = await dumpTables(env.DB, "test");
    const roundTripped = checkBackup(JSON.parse(JSON.stringify(before)));

    // Wreck it: delete things and add junk.
    await db.delete(schema.goals);
    await db.update(schema.accounts).set({ name: "junk" });
    await db.insert(schema.categories).values({ name: "Junk" });

    await env.DB.batch(restoreStatements(roundTripped).map((s) => env.DB.prepare(s)));
    const after = await dumpTables(env.DB, "test");
    expect(after.tables).toEqual(before.tables);
    expect(after.tables.sms_raw.some((r) => String(r.body).includes("\n"))).toBe(true);
  });
});

describe("weekly automatic backups", () => {
  it("stores every table in KV and keeps the newest 12", async () => {
    for (let i = 1; i <= 14; i++) await kv().put(`${BACKUP_PREFIX}2026-0${Math.ceil(i / 4)}-${String(i).padStart(2, "0")}`, "{}");
    const out = await runBackup(env.DB, kv(), new Date("2026-11-08T21:00:00Z"));
    expect(out.key).toBe(`${BACKUP_PREFIX}2026-11-09`);
    const { keys } = await kv().list({ prefix: BACKUP_PREFIX });
    expect(keys).toHaveLength(BACKUPS_KEPT);
    expect(keys.map((k) => k.name)).toContain(out.key);
    const saved = checkBackup(JSON.parse((await kv().get(out.key))!));
    expect(Object.keys(saved.tables).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(saved.source).toBe("auto");
  });

  it("lists, downloads and runs backups behind the login", async () => {
    await runBackup(env.DB, kv(), new Date("2026-11-15T21:00:00Z"));
    const list = (await (await api("/backups")).json()) as { configured: boolean; backups: { date: string; bytes: number }[] };
    expect(list.configured).toBe(true);
    expect(list.backups[0].date).toBe("2026-11-16");
    expect(list.backups[0].bytes).toBeGreaterThan(100);
    const res = await api("/backups/2026-11-16");
    expect(res.headers.get("content-disposition")).toContain("fintrack-auto-2026-11-16.json");
    expect(checkBackup(await res.json()).version).toBe(2);
    expect((await api("/backups/2020-01-01")).status).toBe(404);
    expect((await api("/backups", { auth: false })).status).toBe(401);
    const run = (await (await api("/backups/run", { method: "POST" })).json()) as { key: string };
    expect(run.key).toMatch(/^backup:\d{4}-\d{2}-\d{2}$/);
    expect((await api("/backups/run", { method: "POST", auth: false })).status).toBe(401);
    // The Settings download is the same restorable format.
    expect(checkBackup(await (await api("/export")).json()).source).toBe("download");
  });

  it("runs on the cron that wrangler.jsonc schedules", () => {
    expect(wranglerConfig).toContain(`"${BACKUP_CRON}"`);
  });
});
