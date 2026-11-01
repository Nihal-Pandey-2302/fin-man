import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { formatPaise } from "../../shared/money";
import type { Db } from "../db";
import { accounts, categories, transactions } from "../db/schema";
import { sendToAll, type PushNote } from "../push";
import { getSetting } from "./settings";

const LOOKBACK_MS = 90 * 86_400_000;

/**
 * The two categories this transaction most likely belongs to: the owner's most used for the same direction
 * in the last 90 days, counting the same account double (card spends and UPI payments differ).
 */
export async function guessCategories(db: Db, t: typeof transactions.$inferSelect) {
  const score = sql<number>`SUM(CASE WHEN ${transactions.accountId} = ${t.accountId} THEN 2 ELSE 1 END)`;
  const used = await db
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji, score })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.direction, t.direction),
        eq(transactions.status, "confirmed"),
        isNotNull(transactions.categoryId),
        eq(categories.archived, false),
        gte(transactions.occurredAt, new Date(t.occurredAt.getTime() - LOOKBACK_MS)),
      ),
    )
    .groupBy(categories.id)
    .orderBy(desc(score), categories.sortOrder)
    .limit(2)
    .all();
  if (used.length >= 2) return used;
  // Not enough history yet: sensible defaults for the direction.
  const defaults = t.direction === "debit" ? ["Food & dining", "Groceries"] : ["Other income", "Salary"];
  const extra = await db.select({ id: categories.id, name: categories.name, emoji: categories.emoji }).from(categories).where(eq(categories.archived, false)).all();
  const picked = [...used];
  for (const name of defaults) {
    const c = extra.find((x) => x.name === name);
    if (c && picked.length < 2 && !picked.some((p) => p.id === c.id)) picked.push({ ...c, score: 0 });
  }
  return picked;
}

/**
 * Push for a transaction an SMS just created that needs the owner's eye: two category buttons, so it can be
 * filed from the notification without opening the app. Null when there's nothing to ask.
 */
export async function newTxnNote(db: Db, txnId: number): Promise<PushNote | null> {
  const t = await db.select().from(transactions).where(eq(transactions.id, txnId)).get();
  if (!t || t.status !== "needs_review" || t.transferGroupId || !["expense", "income", "refund"].includes(t.kind)) return null;
  const account = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, t.accountId)).get();
  const guesses = await guessCategories(db, t);
  const sign = t.direction === "debit" ? "−" : "+";
  return {
    title: `${sign}${formatPaise(t.amountPaise)} · ${t.merchant ?? (t.direction === "debit" ? "Payment" : "Money received")}`,
    body: `${account?.name ?? "Account"}. Pick a category, or tap to review.`,
    url: "/activity/review",
    tag: `txn:${t.id}`,
    txnId: t.id,
    actions: guesses.map((c) => ({ action: `cat:${c.id}`, title: `${c.emoji ?? ""} ${c.name}`.trim() })),
  };
}

export async function notifyNewTxn(db: Db, env: Env, txnId: number, fetcher?: typeof fetch) {
  if (!(await getSetting(db, "notify_new_txns"))) return;
  const note = await newTxnNote(db, txnId);
  if (note) await sendToAll(db, env, note, fetcher);
}
