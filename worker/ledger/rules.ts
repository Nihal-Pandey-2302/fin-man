import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { merchantRules, transactions, type TXN_KINDS } from "../db/schema";

export type Rule = typeof merchantRules.$inferSelect;
type Kind = (typeof TXN_KINDS)[number];

const SUFFIXES = /\b(?:pvt|private|ltd|limited|llp|india|inc|co)\b\.?/g;

/** Stable rule key for a merchant name: "HDFC SECURITIES LTD" → "hdfc securities", "ETERNAL LIMITED" → "eternal". */
export function ruleKey(merchant: string): string {
  const key = merchant
    .toLowerCase()
    .replace(/[^a-z0-9@._\s-]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key || merchant.toLowerCase().trim();
}

/** Best rule for a merchant/VPA: the longest matching pattern wins (most specific). */
export function findRule(rules: Rule[], merchant: string | null, vpa: string | null): Rule | null {
  // Raw text for regexes and hand-written rules, plus the ruleKey form that learned rules are stored in.
  const haystack = [merchant?.toLowerCase(), merchant ? ruleKey(merchant) : null, vpa?.toLowerCase()].filter(Boolean).join(" | ");
  if (!haystack) return null;
  let best: Rule | null = null;
  for (const rule of rules) {
    let hit = false;
    if (rule.matchType === "substring") {
      hit = haystack.includes(rule.match.toLowerCase());
    } else {
      try {
        hit = new RegExp(rule.match, "i").test(haystack);
      } catch {
        hit = false; // an invalid regex never matches
      }
    }
    if (hit && (!best || rule.match.length > best.match.length)) best = rule;
  }
  return best;
}

export const loadRules = (db: Db) => db.select().from(merchantRules).all();

export async function bumpRuleHits(db: Db, ruleId: number) {
  await db
    .update(merchantRules)
    .set({ hits: sql`${merchantRules.hits} + 1` })
    .where(eq(merchantRules.id, ruleId));
}

/**
 * Remember the owner's choice for this merchant. Masked VPAs ("*llet@phonepe") and very short names are
 * too vague to learn from. Returns the rule, or null when nothing was learned.
 */
export async function learnRule(
  db: Db,
  merchant: string | null,
  categoryId: number | null,
  kindOverride: Kind | null = null,
): Promise<Rule | null> {
  if (!merchant || merchant.startsWith("*")) return null;
  const match = ruleKey(merchant);
  if (match.length < 3) return null;
  const [rule] = await db
    .insert(merchantRules)
    .values({ match, matchType: "substring", categoryId, kindOverride })
    .onConflictDoUpdate({
      target: [merchantRules.matchType, merchantRules.match],
      set: { categoryId, kindOverride, updatedAt: new Date() },
    })
    .returning();
  return rule;
}

/**
 * Categorise every uncategorised, unpaired transaction that `rule` matches (optionally only those waiting in
 * the review inbox). Returns how many changed.
 */
export async function applyRuleToUncategorized(db: Db, rule: Rule, opts: { onlyNeedsReview?: boolean; excludeId?: number } = {}) {
  const candidates = await db
    .select({ id: transactions.id, merchant: transactions.merchant, vpa: transactions.counterpartyVpa })
    .from(transactions)
    .where(
      and(
        isNull(transactions.categoryId),
        isNull(transactions.transferGroupId),
        opts.onlyNeedsReview ? eq(transactions.status, "needs_review") : undefined,
      ),
    )
    .all();
  const ids = candidates.filter((t) => t.id !== opts.excludeId && findRule([rule], t.merchant, t.vpa)).map((t) => t.id);
  // D1 allows at most 100 bound parameters per statement.
  for (let i = 0; i < ids.length; i += 90) {
    await db
      .update(transactions)
      .set({ categoryId: rule.categoryId, status: "confirmed", ...(rule.kindOverride && { kind: rule.kindOverride }) })
      .where(inArray(transactions.id, ids.slice(i, i + 90)));
  }
  return ids.length;
}
