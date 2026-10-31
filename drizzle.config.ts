import { defineConfig } from "drizzle-kit";

// Generate-only: drizzle-kit writes SQL into ./migrations, wrangler applies it to D1
// (`npm run db:migrate` locally). drizzle-kit never connects to a database here.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
