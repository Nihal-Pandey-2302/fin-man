import { sql } from "drizzle-orm";
import type { LateSms } from "../../shared/api";
import type { Db } from "../db";

/**
 * Some bank SMS give only the day (HDFC's UPI alerts), so the transaction takes the time the SMS reached the
 * phone, and banks can be minutes late. One that lands just after a hand-set balance may already be in it.
 */
export const LATE_SMS_WINDOW_MS = 30 * 60_000;

/**
 * Transactions whose SMS had no time of day and arrived within LATE_SMS_WINDOW_MS after the owner set the
 * account's balance by hand, while that balance is still what the account is worked out from. Either one
 * transaction, or everything waiting in the review inbox.
 */
export async function lateAfterCorrection(db: Db, txnId?: number): Promise<LateSms[]> {
  const which = txnId === undefined ? sql`t.status = 'needs_review'` : sql`t.id = ${txnId}`;
  const rows = await db.all<{ id: number; account_id: number; paise: number; at: number }>(sql`
    SELECT t.id, t.account_id, a.opening_balance_paise AS paise, a.opening_balance_at AS at
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN sms_raw s ON s.id = t.sms_id
    WHERE ${which}
      AND a.opening_balance_at IS NOT NULL
      AND t.occurred_at = s.received_at
      AND t.balance_after_paise IS NULL AND t.available_limit_paise IS NULL
      AND t.occurred_at >= a.opening_balance_at
      AND t.occurred_at <= a.opening_balance_at + ${LATE_SMS_WINDOW_MS}
      AND NOT EXISTS (
        SELECT 1 FROM transactions b
        WHERE b.account_id = a.id AND b.occurred_at >= a.opening_balance_at
          AND (b.balance_after_paise IS NOT NULL OR b.available_limit_paise IS NOT NULL))
  `);
  return rows.map((r) => ({ transactionId: r.id, accountId: r.account_id, correctedPaise: r.paise, correctedAt: new Date(r.at).toISOString() }));
}
