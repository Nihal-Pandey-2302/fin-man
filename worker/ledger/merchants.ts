import { and, desc, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { MerchantDetail } from "../../shared/api";
import { ruleKey } from "../../shared/merchant";
import { addMonths, istDate } from "../../shared/time";
import type { Db } from "../db";
import { transactions } from "../db/schema";
import { serializeTxn } from "./dashboard";
import { findRule, learnRule, loadRules, applyRuleToUncategorized } from "./rules";

type Row = typeof transactions.$inferSelect;

/** SPEND (see dashboard.ts) for one row: expenses and fees count, refunds count back. */
const spendOf = (t: Row) =>
  t.direction === "debit" && (t.kind === "expense" || t.kind === "fee") ? (t.sharePaise ?? t.amountPaise) : t.direction === "credit" && t.kind === "refund" ? -t.amountPaise : 0;

/**
 * Every transaction whose merchant has this rule key. The database narrows by the key's longest word, then
 * the exact key is checked here (it normalises case, punctuation and "Pvt Ltd"-style suffixes).
 */
export async function merchantTransactions(db: Db, key: string): Promise<Row[]> {
  const word = key.split(" ").sort((a, b) => b.length - a.length)[0] ?? key;
  const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select()
    .from(transactions)
    .where(and(isNotNull(transactions.merchant), sql`LOWER(${transactions.merchant}) LIKE ${like} ESCAPE '\\'`))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(5000)
    .all();
  return rows.filter((t) => ruleKey(t.merchant!) === key);
}

export async function merchantDetail(db: Db, key: string, today = istDate()): Promise<MerchantDetail | null> {
  const rows = await merchantTransactions(db, key);
  if (rows.length === 0) return null;
  const latest = rows[0];
  const spends = rows.filter((t) => spendOf(t) > 0);
  const spentPaise = rows.reduce((s, t) => s + spendOf(t), 0);
  const receivedPaise = rows.filter((t) => t.direction === "credit" && t.kind !== "refund").reduce((s, t) => s + t.amountPaise, 0);

  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(`${thisMonth}-01`, i - 11).slice(0, 7));
  const byMonth = new Map(months.map((m) => [m, 0]));
  for (const t of rows) {
    const m = istDate(t.occurredAt).slice(0, 7);
    if (byMonth.has(m)) byMonth.set(m, byMonth.get(m)! + spendOf(t));
  }

  const counts = new Map<number, number>();
  for (const t of rows) if (t.categoryId !== null) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  const categoryId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rule = findRule(await loadRules(db), latest.merchant, latest.counterpartyVpa);

  return {
    key,
    name: latest.merchant!,
    count: rows.length,
    spentPaise,
    receivedPaise,
    avgPaise: spends.length ? Math.round(spends.reduce((s, t) => s + t.amountPaise, 0) / spends.length) : 0,
    firstOn: istDate(rows.at(-1)!.occurredAt),
    lastOn: istDate(latest.occurredAt),
    monthly: months.map((month) => ({ month, spentPaise: Math.max(0, byMonth.get(month)!) })),
    categoryId,
    rule: rule ? { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() } : null,
    transactions: rows.slice(0, 100).map(serializeTxn),
  };
}

/**
 * File this merchant under a category from now on (its rule), and optionally re-file its past payments too.
 * Transfers and card payments keep no category, so they're left alone. Returns how many past payments changed.
 */
export async function setMerchantCategory(db: Db, key: string, categoryId: number, applyToPast: boolean) {
  const rows = await merchantTransactions(db, key);
  if (rows.length === 0) return null;
  const rule = await learnRule(db, rows[0].merchant, categoryId);
  if (!applyToPast) return { changed: rule ? await applyRuleToUncategorized(db, rule) : 0 };
  const ids = rows.filter((t) => t.categoryId !== categoryId).map((t) => t.id);
  if (ids.length === 0) return { changed: 0 };
  // D1 limits bound parameters per statement: update in chunks.
  let changed = 0;
  for (let i = 0; i < ids.length; i += 90) {
    const res = await db
      .update(transactions)
      .set({ categoryId, status: "confirmed" })
      .where(and(inArray(transactions.id, ids.slice(i, i + 90)), notInArray(transactions.kind, ["transfer", "card_payment"])))
      .returning({ id: transactions.id });
    changed += res.length;
  }
  return { changed };
}
