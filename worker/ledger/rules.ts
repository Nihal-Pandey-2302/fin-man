import { eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { merchantRules, type TXN_KINDS } from "../db/schema";

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
  const haystack = `${merchant ?? ""} ${vpa ?? ""}`.toLowerCase().trim();
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
