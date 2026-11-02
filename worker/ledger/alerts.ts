import { and, desc, eq, gte, max } from "drizzle-orm";
import type { AccountBalance, Alert, CardStatus } from "../../shared/api";
import { formatPaise } from "../../shared/money";
import { addDays, addMonths, daysBetween, formatShortDate, istDate, istDayStart, parseDate } from "../../shared/time";
import type { Db } from "../db";
import { accounts, smsRaw, transactions } from "../db/schema";
import type { ParsedNotice } from "../sms/parsers";
import { autopayCalendar, findAutopayForNotice } from "./autopays";
import { computeBalances } from "./balances";
import { cardStatuses } from "./cards";
import { currentCycle, type CurrentCycle } from "./cycles";
import { getSettings } from "./settings";

/** Days without any SMS reaching the server before we suspect forwarding on the phone has stopped. */
export const SMS_STALE_DAYS = 3;

/** When the newest SMS we hold was received (any status: OTP markers prove forwarding works too). */
export async function lastSmsAt(db: Db): Promise<Date | null> {
  const row = await db.select({ at: max(smsRaw.receivedAt) }).from(smsRaw).get();
  return row?.at ?? null;
}

/** Share of the card limit a statement should report for the best credit score (under 30% is fine, ~10% best). */
export const REPORT_TARGET = 0.1;

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/**
 * Things worth the owner's attention today (dashboard banners and the daily push):
 * salary not in yet, card bill due soon, autopay account short of what's due, autopays due tomorrow,
 * bank autopay heads-ups for mandates that aren't tracked, and SMS forwarding gone quiet.
 */
type Precomputed = { accountRows: (typeof accounts.$inferSelect)[]; balances: Map<number, AccountBalance>; cycle: CurrentCycle; lastSms: Date | null; cards: CardStatus[] };

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
        alerts.push({ key: `salary_missing:${today.slice(0, 7)}`, level: "warn", title: "Salary not recorded yet", body: "If it has arrived, record it so the new cycle starts.", href: "/?salary=1" });
      }
    }
  }

  // Cards: pay the statement in full by the due date (interest otherwise), and keep utilization low.
  const cards = pre?.cards ?? (await cardStatuses(db, accountRows, balances, today));
  for (const s of cards) {
    const card = accountRows.find((a) => a.id === s.accountId)!;
    const b = balances.get(card.id);
    if (s.status === "overdue") {
      alerts.push({ key: `card_overdue:${card.id}:${s.dueDate}`, level: "danger", title: `${card.name} bill overdue`, body: `Pay ${formatPaise(s.leftToPayPaise!)} now to limit interest and late fees (was due ${formatShortDate(s.dueDate!)}).`, href: "/" });
    } else if (s.status === "due" && s.daysToDue !== null && s.daysToDue <= 3) {
      alerts.push({
        key: `card_due:${card.id}:${s.dueDate}`,
        level: s.daysToDue <= 1 ? "danger" : "warn",
        title: `Pay ${formatPaise(s.leftToPayPaise!)} on ${card.name} ${inDays(s.daysToDue)}`,
        body: `Statement of ${formatShortDate(s.statementDate!)}. Pay it in full by ${formatShortDate(s.dueDate!)} to avoid interest.`,
        href: "/",
      });
    } else if (s.status === "unknown" && b?.nextDueOn && b.balancePaise > 0) {
      // Statement amount unknown: fall back to what's owed in total.
      const n = daysBetween(today, b.nextDueOn);
      if (n <= 3) {
        alerts.push({ key: `card_due:${card.id}:${b.nextDueOn}`, level: n <= 1 ? "danger" : "warn", title: `${card.name} bill due ${inDays(n)}`, body: `${formatPaise(b.balancePaise)} outstanding · due ${formatShortDate(b.nextDueOn)}. Enter the statement amount to see exactly what's due.`, href: "/" });
      }
    }
    // Credit history: the statement balance is what's reported to the credit bureaus. A day or two before the
    // statement, if it would report more than ~10% of the limit, say how much to pay first.
    const toStatement = b?.nextStatementOn ? daysBetween(today, b.nextStatementOn) : null;
    if (b && toStatement !== null && toStatement >= 1 && toStatement <= 2 && s.limitPaise && s.outstandingPaise > s.limitPaise * REPORT_TARGET) {
      const payPaise = Math.ceil((s.outstandingPaise - s.limitPaise * REPORT_TARGET) / 10_000) * 10_000;
      alerts.push({
        key: `card_prestatement:${card.id}:${b.nextStatementOn}`,
        level: "warn",
        title: `Pay ${formatPaise(payPaise)} on ${card.name} before ${formatShortDate(b.nextStatementOn!)}`,
        body: `The statement reports ${formatPaise(s.outstandingPaise)} (${Math.round((s.outstandingPaise / s.limitPaise) * 100)}% of the limit) to the credit bureaus. Paying this first keeps it near 10%, which is best for your credit score.`,
        href: "/",
      });
    }
    if (b?.nextStatementOn === today) {
      alerts.push({ key: `card_statement:${card.id}:${today}`, level: "info", title: `${card.name} statement today`, body: `${formatPaise(b.balancePaise)} outstanding`, href: "/" });
    }
    if (s.utilization !== null && s.utilization >= 0.3) {
      const pct = Math.round(s.utilization * 100);
      alerts.push({
        key: `card_util:${card.id}:${s.statementDate ?? "none"}`,
        level: s.utilization >= 0.5 ? "warn" : "info",
        title: `${card.name} at ${pct}% of its limit`,
        body: `${formatPaise(s.outstandingPaise)} of ${formatPaise(s.limitPaise!)} used. Under 30% is better for your credit score.`,
        href: "/",
        // Pushed once a month (on statement day); otherwise just a banner.
        quiet: today !== s.statementDate,
      });
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

