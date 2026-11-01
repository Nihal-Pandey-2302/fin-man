// Every table must be in the backups (Settings download, /api/export, `npm run backup`), or a restore loses data.
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { EXPORT_TABLES } from "../worker/routes/misc";
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
