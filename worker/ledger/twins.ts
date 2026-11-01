import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { addDays, istDate, istDayStart } from "../../shared/time";
import type { Db } from "../db";
import { transactions } from "../db/schema";
import type { ParsedTxn } from "../sms/parsers";

/** What an SMS says about the money, plus where it landed. Details are optional (a hand-made entry from an unread SMS has none). */
type TwinInput = Pick<ParsedTxn, "occurredAt" | "direction" | "amountPaise"> &
  Partial<Pick<ParsedTxn, "counterparty" | "vpa" | "refNo" | "balanceAfterPaise" | "availableLimitPaise" | "channel">> & { accountId: number; smsId: number };

/** Same window as transfer pairing: a manual entry and its SMS rarely land more than a day or two apart. */
const TWIN_WINDOW_DAYS = 2;

/**
 * Link an SMS to a hand-made transaction for the same money: same account, direction and amount, within
 * ±2 IST days, not yet backed by an SMS. The closest in time wins. The entry keeps its category, kind and
 * links (salary cycle, transfer pair, autopay), which were settled when it was created; it gains the
 * SMS's details (balance, ref, VPA) and, on the same IST day, the SMS's exact time.
 */
export async function adoptManualTwin(db: Db, t: TwinInput): Promise<number | null> {
  const { accountId, smsId } = t;
  const day = istDate(t.occurredAt);
  const candidates = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.direction, t.direction),
        eq(transactions.amountPaise, t.amountPaise),
        eq(transactions.source, "manual"),
        isNull(transactions.smsId),
        gte(transactions.occurredAt, istDayStart(addDays(day, -TWIN_WINDOW_DAYS))),
        lt(transactions.occurredAt, istDayStart(addDays(day, TWIN_WINDOW_DAYS + 1))),
      ),
    )
    .all();
  const best = candidates.sort((a, b) => Math.abs(+a.occurredAt - +t.occurredAt) - Math.abs(+b.occurredAt - +t.occurredAt))[0];
  if (!best) return null;
  const [linked] = await db
    .update(transactions)
    .set({
      smsId,
      source: "sms",
      ...(istDate(best.occurredAt) === day && { occurredAt: t.occurredAt }),
      merchant: best.merchant ?? t.counterparty ?? null,
      counterpartyVpa: best.counterpartyVpa ?? t.vpa ?? null,
      refNo: best.refNo ?? t.refNo ?? null,
      balanceAfterPaise: t.balanceAfterPaise ?? best.balanceAfterPaise,
      availableLimitPaise: t.availableLimitPaise ?? best.availableLimitPaise,
      channel: best.channel ?? t.channel ?? null,
    })
    // Guards a concurrent ingest of another SMS for the same entry: only one can claim it.
    .where(and(eq(transactions.id, best.id), isNull(transactions.smsId)))
    .returning({ id: transactions.id });
  return linked?.id ?? null;
}
