import { and, desc, eq, gte, max } from "drizzle-orm";
import type { AccountBalance, Alert } from "../../shared/api";
import { formatPaise } from "../../shared/money";
import { addDays, addMonths, daysBetween, formatShortDate, istDate, istDayStart, parseDate } from "../../shared/time";
import type { Db } from "../db";
import { accounts, smsRaw, transactions } from "../db/schema";
import type { ParsedNotice } from "../sms/parsers";
import { autopayCalendar, findAutopayForNotice } from "./autopays";
import { computeBalances } from "./balances";
import { currentCycle, type CurrentCycle } from "./cycles";
import { getSettings } from "./settings";

/** Days without any SMS reaching the server before we suspect forwarding on the phone has stopped. */
export const SMS_STALE_DAYS = 3;

/** When the newest SMS we hold was received (any status: OTP markers prove forwarding works too). */
export async function lastSmsAt(db: Db): Promise<Date | null> {
  const row = await db.select({ at: max(smsRaw.receivedAt) }).from(smsRaw).get();
  return row?.at ?? null;
}

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/**
 * Things worth the owner's attention today (dashboard banners and the daily push):
 * salary not in yet, card bill due soon, autopay account short of what's due, autopays due tomorrow,
 * bank autopay heads-ups for mandates that aren't tracked, and SMS forwarding gone quiet.
 */
type Precomputed = { accountRows: (typeof accounts.$inferSelect)[]; balances: Map<number, AccountBalance>; cycle: CurrentCycle; lastSms: Date | null };

export async function buildAlerts(db: Db, today = istDate(), pre?: Precomputed): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const [accountRows, settings, cycle, lastSms] = await Promise.all([
    pre?.accountRows ?? db.select().from(accounts).where(eq(accounts.archived, false)).all(),
    getSettings(db),
    pre?.cycle ?? currentCycle(db, today),
    pre ? pre.lastSms : lastSmsAt(db),
  ]);

  // Forwarding gone quiet: banks text several times a week, so days of silence usually means the phone side stopped.
  if (lastSms) {
    const quiet = daysBetween(istDate(lastSms), today);
    if (quiet >= SMS_STALE_DAYS) {
      alerts.push({ key: `sms_stale:${istDate(lastSms)}`, level: "warn", title: `No bank SMS for ${quiet} days`, body: "Check that MacroDroid is still running and battery optimisation is off for it.", href: "/more/settings" });
    }
  }
  const balances = pre?.balances ?? (await computeBalances(db, accountRows, today));

  // Salary missing: from the 5th, if no salary since the 28th of last month.
  const day = parseDate(today).d;
  if (day >= 5 && day < 28) {
    const windowStart = addMonths(`${today.slice(0, 8)}28`, -1);
    const everPaid = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.incomeSource, "salary")).limit(1).get();
    if (everPaid || settings.salary_min_paise > 0) {
      const thisMonth = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.incomeSource, "salary"), gte(transactions.occurredAt, istDayStart(windowStart))))
        .limit(1)
        .get();
      if (!thisMonth) {
        alerts.push({ key: `salary_missing:${today.slice(0, 7)}`, level: "warn", title: "Salary not detected yet", body: "If it has arrived, mark the credit as salary in the review inbox.", href: "/activity" });
      }
    }
  }

  // Card bill due soon.
  for (const card of accountRows.filter((a) => a.kind === "credit_card")) {
    const b = balances.get(card.id);
    if (!b?.nextDueOn || b.balancePaise <= 0) continue;
    const n = daysBetween(today, b.nextDueOn);
    if (n <= 3) {
      alerts.push({ key: `card_due:${card.id}:${b.nextDueOn}`, level: n <= 1 ? "danger" : "warn", title: `${card.name} bill due ${inDays(n)}`, body: `${formatPaise(b.balancePaise)} outstanding · due ${formatShortDate(b.nextDueOn)}`, href: "/plan" });
    }
    if (b.nextStatementOn === today) {
      alerts.push({ key: `card_statement:${card.id}:${today}`, level: "info", title: `${card.name} statement today`, body: `${formatPaise(b.balancePaise)} outstanding`, href: "/more/accounts" });
    }
  }

  // Autopays: overdue ones not seen yet, account short of what's still due (overdue included), tomorrow's.
  const occurrences = await autopayCalendar(db, cycle.startDate < today ? cycle.startDate : today, cycle.endDate, today);
  for (const o of occurrences.filter((x) => x.status === "overdue")) {
    alerts.push({ key: `autopay_overdue:${o.autopayId}:${o.dueOn}`, level: "warn", title: `${o.name} not seen yet`, body: `${formatPaise(o.amountPaise)} was due ${formatShortDate(o.dueOn)}. If it went through, mark it paid in Plan.`, href: "/plan" });
  }
  // Cards are excluded: their balance is money owed, not money available.
  for (const acc of accountRows.filter((a) => a.kind !== "credit_card")) {
    const due = occurrences.filter((o) => o.accountId === acc.id && o.status !== "paid").reduce((s, o) => s + o.amountPaise, 0);
    const bal = balances.get(acc.id)?.balancePaise ?? 0;
    if (due > 0 && bal < due) {
      alerts.push({ key: `autopay_short:${acc.id}:${today}`, level: "danger", title: `${acc.name} is ${formatPaise(due - bal)} short`, body: `${formatPaise(due)} of autopays due by ${formatShortDate(cycle.endDate)}; balance ${formatPaise(bal)}.`, href: "/plan" });
    }
  }
  const tomorrow = occurrences.filter((o) => o.dueOn === addDays(today, 1) && o.status === "due");
  if (tomorrow.length) {
    alerts.push({
      key: `autopay_tomorrow:${today}`,
      level: "info",
      title: `${tomorrow.length === 1 ? tomorrow[0].name : `${tomorrow.length} autopays`} due tomorrow`,
      body: tomorrow.map((o) => `${o.name} ${formatPaise(o.amountPaise)}`).join(" · "),
      href: "/plan",
    });
  }

  // Bank heads-ups ("will be debited … for the Autopay on …") for mandates we don't track.
  const notices = await db
    .select({ parsedJson: smsRaw.parsedJson })
    .from(smsRaw)
    .where(and(eq(smsRaw.error, "autopay_upcoming"), gte(smsRaw.receivedAt, istDayStart(addDays(today, -10)))))
    .orderBy(desc(smsRaw.receivedAt))
    .all();
  const seen = new Set<string>();
  for (const n of notices) {
    const notice = JSON.parse(n.parsedJson ?? "null") as ParsedNotice | null;
    // Banks repeat the heads-up; one alert per mandate and date.
    const key = notice && `untracked_autopay:${notice.payee}:${notice.dueOn}`;
    if (!notice || !key || seen.has(key) || notice.dueOn < today) continue;
    seen.add(key);
    if (await findAutopayForNotice(db, notice)) continue;
    alerts.push({ key, level: "info", title: `Untracked autopay: ${notice.payee}`, body: `${formatPaise(notice.amountPaise)} on ${formatShortDate(notice.dueOn)}. Add it so safe-to-spend accounts for it.`, href: "/plan" });
  }

  return alerts;
}

