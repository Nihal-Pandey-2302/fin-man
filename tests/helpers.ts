import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { getDb, schema } from "../worker/db";

export const db = getDb(env.DB);
export { schema };

const fixtures = import.meta.glob<string>("./fixtures/sms/**/*.txt", { query: "?raw", import: "default", eager: true });
export function fixture(path: string): string {
  const body = fixtures[`./fixtures/sms/${path}`];
  if (body === undefined) throw new Error(`missing fixture ${path}`);
  return body;
}

export function api(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  return exports.default.fetch(`http://local/api${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

export function postSms(sender: string, body: string, receivedAt?: string | number, secret = env.INGEST_SECRET) {
  return api("/ingest/sms", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    json: { sender, body, received_at: receivedAt },
  });
}

/** Wipe ledger tables between tests (seeded categories and rules stay). */
export async function resetLedger() {
  const s = schema;
  await db.delete(s.loanPayments);
  await db.delete(s.categoryBudgets);
  await db.delete(s.budgetCycles);
  await db.delete(s.pushSubscriptions);
  await db.delete(s.transactions);
  await db.delete(s.smsRaw);
  await db.delete(s.autopays);
  await db.delete(s.quickAddPresets);
  await db.delete(s.accountNumbers);
  await db.delete(s.accounts);
  await db.delete(s.settings);
  await db.delete(s.loans);
  await db.delete(s.holdings);
}

/** The owner's real setup, with fake numbers matching the fixtures. */
export async function seedAccounts() {
  const s = schema;
  const rows = await db
    .insert(s.accounts)
    .values([
      { name: "HDFC Bank", institution: "HDFC", kind: "bank", role: "salary" },
      { name: "IDFC FIRST", institution: "IDFC", kind: "bank", role: "spending" },
      { name: "Indian Bank", institution: "INDIAN", kind: "bank", role: "autopay" },
      { name: "IDFC Credit Card", institution: "IDFC", kind: "credit_card", role: "card", creditLimitPaise: 2_500_000 },
      { name: "Cash", institution: "CASH", kind: "cash", role: "other" },
    ])
    .returning();
  const [hdfc, idfc, indian, card, cash] = rows;
  await db.insert(s.accountNumbers).values([
    { accountId: hdfc.id, last4: "4444" },
    { accountId: idfc.id, last4: "3456" },
    { accountId: indian.id, last4: "7777" },
    { accountId: card.id, last4: "1111", label: "RuPay (UPI)" },
    { accountId: card.id, last4: "2222", label: "Mastercard" },
  ]);
  return { hdfc, idfc, indian, card, cash };
}
