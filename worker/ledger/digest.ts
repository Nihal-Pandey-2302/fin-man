import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { formatPaise } from "../../shared/money";
import { addDays, istDate, istDayStart, formatShortDate } from "../../shared/time";
import type { Db } from "../db";
import { categories, transactions } from "../db/schema";
import { sendToAll, type PushNote } from "../push";
import { getSetting } from "./settings";
import { autopayCalendar } from "./autopays";
import { buildDashboard, SPEND, spentBetween } from "./dashboard";

export type Digest = {
  weekStart: string;
  weekEnd: string;
  spentPaise: number;
  previousPaise: number;
  top: { name: string; emoji: string | null; spentPaise: number } | null;
  /** This cycle: what's left to spend and per day (null without a budget). */
  cycle: { leftPaise: number; daysLeft: number; perDayPaise: number } | null;
  /** Due in the next 7 days. */
  coming: { name: string; amountPaise: number; dueOn: string }[];
  reviewCount: number;
};

/** The week that ends today (7 IST days), the one before, and what's coming in the next 7 days. */
export async function buildDigest(db: Db, now = new Date()): Promise<Digest> {
  const today = istDate(now);
  const weekStart = addDays(today, -6);
  const from = istDayStart(weekStart);
  const to = istDayStart(addDays(today, 1));
  const [spentPaise, previousPaise, topRow, d, occurrences] = await Promise.all([
    spentBetween(db, from, to),
    spentBetween(db, istDayStart(addDays(weekStart, -7)), from),
    db
      .select({ name: sql<string | null>`${categories.name}`, emoji: categories.emoji, spentPaise: sql<number>`SUM(${SPEND})` })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)))
      .groupBy(transactions.categoryId)
      .having(sql`SUM(${SPEND}) > 0`)
      .orderBy(desc(sql`SUM(${SPEND})`))
      .limit(1)
      .get(),
    buildDashboard(db, now),
    autopayCalendar(db, addDays(today, 1), addDays(today, 7), today),
  ]);

  const coming = [
    ...d.cards
      .filter((c) => (c.status === "due" || c.status === "overdue") && c.dueDate && c.dueDate <= addDays(today, 7) && c.leftToPayPaise)
      .map((c) => ({ name: "Card bill", amountPaise: c.leftToPayPaise!, dueOn: c.dueDate! })),
    ...occurrences.filter((o) => o.status === "due").map((o) => ({ name: o.name, amountPaise: o.amountPaise, dueOn: o.dueOn })),
  ].sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  return {
    weekStart,
    weekEnd: today,
    spentPaise,
    previousPaise,
    top: topRow ? { name: topRow.name ?? "Uncategorised", emoji: topRow.emoji, spentPaise: topRow.spentPaise } : null,
    cycle: d.cycle.budgetPaise > 0 ? { leftPaise: d.cycle.remainingPaise, daysLeft: d.cycle.daysLeft, perDayPaise: d.cycle.dailyAllowancePaise } : null,
    coming,
    reviewCount: d.reviewCount,
  };
}

/** The Sunday push: one short notification, details on Home. */
export function digestNote(g: Digest): PushNote {
  const change =
    g.previousPaise > 0
      ? g.spentPaise > g.previousPaise
        ? ` (up from ${formatPaise(g.previousPaise)})`
        : g.spentPaise < g.previousPaise
          ? ` (down from ${formatPaise(g.previousPaise)})`
          : ""
      : "";
  const parts = [
    g.top && `Most on ${g.top.emoji ? `${g.top.emoji} ` : ""}${g.top.name}: ${formatPaise(g.top.spentPaise)}.`,
    g.cycle &&
      (g.cycle.leftPaise >= 0
        ? `${formatPaise(g.cycle.leftPaise)} left for ${g.cycle.daysLeft} ${g.cycle.daysLeft === 1 ? "day" : "days"} (${formatPaise(g.cycle.perDayPaise)}/day).`
        : `${formatPaise(-g.cycle.leftPaise)} over this cycle's budget.`),
    g.coming.length > 0 && `Coming up: ${g.coming.slice(0, 3).map((c) => `${c.name} ${formatPaise(c.amountPaise)} (${formatShortDate(c.dueOn)})`).join(", ")}.`,
    g.reviewCount > 0 && `${g.reviewCount} to review.`,
  ].filter(Boolean);
  return {
    title: `Your week: ${formatPaise(g.spentPaise)} spent${change}`,
    body: parts.join(" ") || "A quiet week.",
    url: "/",
    tag: `digest:${g.weekEnd}`,
  };
}

/** Must match the third cron in wrangler.jsonc (Sun 14:00 UTC = 19:30 IST). */
export const DIGEST_CRON = "0 14 * * SUN";

export async function runDigest(db: Db, env: Env, fetcher?: typeof fetch) {
  if (!(await getSetting(db, "weekly_digest"))) return { sent: 0, skipped: "off" };
  return sendToAll(db, env, digestNote(await buildDigest(db)), fetcher);
}
