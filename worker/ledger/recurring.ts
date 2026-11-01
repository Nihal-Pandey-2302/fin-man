import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { Recurring, RecurringReport } from "../../shared/api";
import { addDays, daysBetween, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { autopays, transactions } from "../db/schema";
import { MONTHS_PER } from "./autopays";
import { ruleKey } from "./rules";
import { getSetting } from "./settings";

/** Typical gaps between charges (days) for each schedule, with the slack real billing has. */
const SCHEDULES = [
  { frequency: "monthly", min: 25, max: 35, minCount: 3 },
  { frequency: "quarterly", min: 80, max: 100, minCount: 2 },
  { frequency: "yearly", min: 350, max: 380, minCount: 2 },
] as const;
const LOOKBACK_DAYS = 400;
/** Charges whose amounts stay within ±10% of their median count as the same payment. */
const AMOUNT_TOLERANCE = 0.1;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * Payments that look like subscriptions or bills: the same merchant charged at a steady interval with a
 * steady amount, recently enough to still be running, and not already tracked as an autopay. Cheap: one
 * query over a year of debits, grouped in memory.
 */
export async function findRecurring(db: Db, today = istDate()): Promise<RecurringReport> {
  const since = istDayStart(addDays(today, -LOOKBACK_DAYS));
  const [rows, tracked, dismissed] = await Promise.all([
    db
      .select({ merchant: transactions.merchant, amountPaise: transactions.amountPaise, occurredAt: transactions.occurredAt, accountId: transactions.accountId, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.direction, "debit"), eq(transactions.kind, "expense"), isNull(transactions.autopayId), isNull(transactions.transferGroupId), isNotNull(transactions.merchant), gte(transactions.occurredAt, since)))
      .all(),
    db.select().from(autopays).where(eq(autopays.active, true)).all(),
    getSetting(db, "dismissed_recurring"),
  ]);

  // Merchants already covered by an autopay (by name or its SMS hint) aren't suggestions.
  const trackedKeys = tracked.flatMap((a) => [a.name, a.matchHint].filter((x): x is string => !!x).map(ruleKey));
  const covered = (key: string) => trackedKeys.some((k) => k.length >= 3 && (key.includes(k) || k.includes(key)));
  const skip = new Set(dismissed);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = ruleKey(r.merchant!);
    if (skip.has(key) || covered(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const found: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const typical = median(list.map((r) => r.amountPaise));
    // Keep the charges that look like the same payment (a one-off bigger order at the same shop doesn't count).
    const same = list.filter((r) => Math.abs(r.amountPaise - typical) <= typical * AMOUNT_TOLERANCE).sort((a, b) => +a.occurredAt - +b.occurredAt);
    const dates = [...new Set(same.map((r) => istDate(r.occurredAt)))];
    if (dates.length < 2) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const gap = median(gaps);
    const schedule = SCHEDULES.find((s) => gap >= s.min && gap <= s.max && dates.length >= s.minCount && gaps.every((g) => g >= s.min * 0.7 && g <= s.max * 1.3));
    if (!schedule) continue;
    const lastOn = dates.at(-1)!;
    // Stopped? More than one and a half gaps since the last charge.
    if (daysBetween(lastOn, today) > gap * 1.5) continue;
    const last = same.at(-1)!;
    const amountPaise = median(same.map((r) => r.amountPaise));
    const cats = same.map((r) => r.categoryId).filter((c): c is number => c !== null);
    found.push({
      key,
      merchant: last.merchant!,
      frequency: schedule.frequency,
      amountPaise,
      monthlyPaise: Math.round(amountPaise / MONTHS_PER[schedule.frequency]),
      count: dates.length,
      lastOn,
      nextOn: addDays(lastOn, gap),
      accountId: last.accountId,
      categoryId: cats.length ? mostCommon(cats) : null,
    });
  }
  found.sort((a, b) => b.monthlyPaise - a.monthlyPaise);
  const trackedMonthlyPaise = tracked.filter((a) => a.kind !== "sip").reduce((s, a) => s + Math.round(a.amountPaise / MONTHS_PER[a.frequency]), 0);
  return { found, trackedMonthlyPaise, foundMonthlyPaise: found.reduce((s, r) => s + r.monthlyPaise, 0) };
}

function mostCommon(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}
