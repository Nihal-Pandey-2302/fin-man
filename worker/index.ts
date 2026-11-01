import { Hono } from "hono";
import { BACKUP_CRON, runBackup, type BackupEnv } from "./backup";
import { runDaily } from "./daily";
import { DIGEST_CRON, runDigest } from "./ledger/digest";
import { getDb } from "./db";
import { accountRoutes } from "./routes/accounts";
import { cardRoutes } from "./routes/cards";
import { merchantRoutes } from "./routes/merchants";
import { authRoutes, requireSession } from "./routes/auth";
import { categoryRoutes, ruleRoutes } from "./routes/categories";
import { importRoutes } from "./routes/import";
import { ingestRoutes } from "./routes/ingest";
import { miscRoutes } from "./routes/misc";
import { autopayRoutes, cycleRoutes, goalRoutes, holdingRoutes, loanRoutes, presetRoutes } from "./routes/plan";
import { pushRoutes } from "./routes/push";
import { reviewRoutes, transactionRoutes, transferRoutes } from "./routes/transactions";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use(async (c, next) => {
  c.set("db", getDb(c.env.DB));
  await next();
});
// Everything except login, health and SMS ingest needs the owner's session (see worker/auth.ts).
app.use(requireSession);

app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  return c.json({ ok: true, db: row?.ok === 1 });
});

app
  .route("/auth", authRoutes)
  .route("/ingest", ingestRoutes)
  .route("/accounts", accountRoutes)
  .route("/cards", cardRoutes)
  .route("/merchants", merchantRoutes)
  .route("/categories", categoryRoutes)
  .route("/rules", ruleRoutes)
  .route("/transactions", transactionRoutes)
  .route("/transfers", transferRoutes)
  .route("/review", reviewRoutes)
  .route("/cycles", cycleRoutes)
  .route("/autopays", autopayRoutes)
  .route("/presets", presetRoutes)
  .route("/loans", loanRoutes)
  .route("/goals", goalRoutes)
  .route("/holdings", holdingRoutes)
  .route("/push", pushRoutes)
  .route("/import", importRoutes)
  .route("/", miscRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  /** Daily reminders and the weekly backup (see `triggers.crons` in wrangler.jsonc). */
  scheduled(controller, env, ctx) {
    const db = getDb(env.DB);
    if (controller.cron === BACKUP_CRON) {
      const kv = (env as Env & BackupEnv).BACKUPS;
      if (kv) ctx.waitUntil(runBackup(env.DB, kv).then((r) => console.log("backup", r)));
      else console.warn("backup skipped: no BACKUPS KV binding");
      return;
    }
    if (controller.cron === DIGEST_CRON) {
      ctx.waitUntil(runDigest(db, env).then((r) => console.log("digest", r)));
      return;
    }
    ctx.waitUntil(runDaily(db, env).then((r) => console.log("daily", r)));
  },
} satisfies ExportedHandler<Env>;
