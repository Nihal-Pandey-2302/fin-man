import { Hono } from "hono";
import { getDb } from "./db";
import { accountRoutes } from "./routes/accounts";
import { categoryRoutes, ruleRoutes } from "./routes/categories";
import { ingestRoutes } from "./routes/ingest";
import { miscRoutes } from "./routes/misc";
import { autopayRoutes, cycleRoutes, holdingRoutes, loanRoutes, presetRoutes } from "./routes/plan";
import { reviewRoutes, transactionRoutes, transferRoutes } from "./routes/transactions";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use(async (c, next) => {
  c.set("db", getDb(c.env.DB));
  await next();
});

app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  return c.json({ ok: true, db: row?.ok === 1 });
});

app
  .route("/ingest", ingestRoutes)
  .route("/accounts", accountRoutes)
  .route("/categories", categoryRoutes)
  .route("/rules", ruleRoutes)
  .route("/transactions", transactionRoutes)
  .route("/transfers", transferRoutes)
  .route("/review", reviewRoutes)
  .route("/cycles", cycleRoutes)
  .route("/autopays", autopayRoutes)
  .route("/presets", presetRoutes)
  .route("/loans", loanRoutes)
  .route("/holdings", holdingRoutes)
  .route("/", miscRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;
export default app;
