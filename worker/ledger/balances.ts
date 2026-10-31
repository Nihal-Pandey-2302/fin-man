import { sql } from "drizzle-orm";
import { istDate, nextDayOfMonth } from "../../shared/time";
import type { AccountBalance } from "../../shared/api";
import type { Db } from "../db";
import type { accounts } from "../db/schema";

type AccountRow = typeof accounts.$inferSelect;
type BalanceRow = {
  id: number;
  anchor_at: number | null;
  bal: number | null;
  avail: number | null;
  net_after_anchor: number;
  net_after_opening: number;
};

/**
 * Balances for every account in one query. Each account is anchored on whichever is newer: the latest
 * SMS-reported figure (bank balance / card available limit) or the opening balance (also used for manual
 * corrections). Transactions after the anchor are then added on top.
 */
export async function computeBalances(db: Db, rows: AccountRow[], today = istDate()): Promise<Map<number, AccountBalance>> {
  const signed = sql`CASE WHEN t.direction = 'credit' THEN t.amount_paise ELSE -t.amount_paise END`;
  const result = await db.all<BalanceRow>(sql`
    WITH ranked AS (
      SELECT account_id, occurred_at, id, balance_after_paise, available_limit_paise,
        ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY occurred_at DESC, id DESC) AS rn
      FROM transactions
      WHERE balance_after_paise IS NOT NULL OR available_limit_paise IS NOT NULL
    )
    SELECT a.id,
      r.occurred_at AS anchor_at,
      r.balance_after_paise AS bal,
      r.available_limit_paise AS avail,
      (SELECT COALESCE(SUM(${signed}), 0) FROM transactions t
        WHERE t.account_id = a.id AND r.id IS NOT NULL
          AND (t.occurred_at > r.occurred_at OR (t.occurred_at = r.occurred_at AND t.id > r.id))) AS net_after_anchor,
      (SELECT COALESCE(SUM(${signed}), 0) FROM transactions t
        WHERE t.account_id = a.id AND (a.opening_balance_at IS NULL OR t.occurred_at >= a.opening_balance_at)) AS net_after_opening
    FROM accounts a
    LEFT JOIN ranked r ON r.account_id = a.id AND r.rn = 1
  `);

  const out = new Map<number, AccountBalance>();
  for (const acc of rows) {
    const r = result.find((x) => x.id === acc.id);
    const isCard = acc.kind === "credit_card";
    const openingAt = acc.openingBalanceAt?.getTime() ?? null;
    const smsUsable =
      r?.anchor_at != null &&
      (openingAt === null || r.anchor_at >= openingAt) &&
      (isCard ? r.avail != null && acc.creditLimitPaise != null : r.bal != null);

    let balancePaise: number;
    let basis: AccountBalance["basis"];
    let asOf: string | null;
    if (smsUsable && r) {
      // Card outstanding grows with debits, so subtract the (credit − debit) net.
      balancePaise = isCard ? acc.creditLimitPaise! - r.avail! - r.net_after_anchor : r.bal! + r.net_after_anchor;
      basis = "sms";
      asOf = new Date(r.anchor_at!).toISOString();
    } else {
      const net = r?.net_after_opening ?? 0;
      balancePaise = isCard ? acc.openingBalancePaise - net : acc.openingBalancePaise + net;
      basis = "manual";
      asOf = acc.openingBalanceAt?.toISOString() ?? null;
    }

    out.set(acc.id, {
      balancePaise,
      basis,
      asOf,
      availableLimitPaise: isCard && acc.creditLimitPaise != null ? acc.creditLimitPaise - balancePaise : null,
      nextDueOn: isCard && acc.dueDay ? nextDayOfMonth(today, acc.dueDay) : null,
      nextStatementOn: isCard && acc.statementDay ? nextDayOfMonth(today, acc.statementDay) : null,
    });
  }
  return out;
}
