#!/usr/bin/env node
// `npm run backup` → backups/fintrack-<date>.json from the LOCAL D1.
// `npm run backup -- --remote` → same from the deployed D1 (uses your wrangler login; no Access needed).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const TABLES = [
  "accounts", "account_numbers", "categories", "transactions", "sms_raw", "merchant_rules", "autopays",
  "budget_cycles", "category_budgets", "holdings", "loans", "loan_payments", "quick_add_presets", "settings",
];
const remote = process.argv.includes("--remote");

const raw = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "--json", "--command", TABLES.map((t) => `SELECT * FROM ${t};`).join(" ")],
  { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
);
const results = JSON.parse(raw);
if (!Array.isArray(results) || results.length !== TABLES.length) throw new Error("unexpected wrangler output");

const tables = Object.fromEntries(TABLES.map((t, i) => [t, results[i].results]));
const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
mkdirSync("backups", { recursive: true });
const file = `backups/fintrack-${remote ? "remote" : "local"}-${stamp}.json`;
writeFileSync(file, JSON.stringify({ app: "fintrack", version: 1, source: remote ? "remote" : "local", exportedAt: new Date().toISOString(), tables }, null, 1));
console.log(`${file}  (${TABLES.map((t) => `${t}: ${tables[t].length}`).join(", ")})`);
