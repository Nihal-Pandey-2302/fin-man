import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { accountNumbers, accounts, smsRaw, transactions } from "../db/schema";
import { pairTransaction } from "../ledger/matcher";
import { bumpRuleHits, findRule, loadRules } from "../ledger/rules";
import { isOtp, isPromo } from "./classify";
import { normalizeBody, normalizeSender, smsHash } from "./normalize";
import { parseSms, type ParsedTxn } from "./parsers";
import { isBankSms } from "./senders";

export type IngestInput = { sender: string; body: string; receivedAt: Date };

export type IngestStatus = "created" | "duplicate" | "ignored" | "unparsed" | "rejected";
export type IngestOutcome = { status: IngestStatus; smsId?: number; transactionId?: number; reason?: string };

type SmsRow = typeof smsRaw.$inferSelect;

/**
 * Store an incoming SMS exactly once and turn it into a transaction when possible.
 * Idempotent: the same SMS (same normalized sender + body) always returns `duplicate` after the first call.
 */
export async function ingestSms(db: Db, input: IngestInput): Promise<IngestOutcome> {
  const sender = normalizeSender(input.sender);
  const body = normalizeBody(input.body);
  const hash = await smsHash(sender, body);

  const otp = isOtp(body);
  if (!otp && !isBankSms(sender, body)) return { status: "rejected", reason: "unknown_sender" };

  const [row] = await db
    .insert(smsRaw)
    .values({
      sender,
      senderRaw: input.sender.slice(0, 64),
      // OTP text never reaches the database: keep only a marker so retries still dedupe on the hash.
      body: otp ? "" : body,
      receivedAt: input.receivedAt,
      hash,
      parseStatus: otp ? "ignored" : "unparsed",
      error: otp ? "otp" : null,
    })
    .onConflictDoNothing({ target: smsRaw.hash })
    .returning();

  if (!row) {
    const existing = await db.select({ id: smsRaw.id }).from(smsRaw).where(eq(smsRaw.hash, hash)).get();
    return { status: "duplicate", smsId: existing?.id };
  }
  if (otp) return { status: "ignored", smsId: row.id, reason: "otp" };
  return processSms(db, row);
}

/** Parse a stored SMS and create its transaction. Safe to re-run (e.g. after adding a missing account). */
export async function processSms(db: Db, row: SmsRow): Promise<IngestOutcome> {
  const parsed = parseSms(row.body, row.receivedAt);

  if (!parsed) {
    const promo = isPromo(row.body);
    await setSmsStatus(db, row.id, promo ? "ignored" : "unparsed", { error: promo ? "promo" : null });
    return { status: promo ? "ignored" : "unparsed", smsId: row.id, reason: promo ? "promo" : "no_parser" };
  }

  const { parser, result } = parsed;
  const parsedJson = JSON.stringify(result);

  if (result.type === "notice") {
    await setSmsStatus(db, row.id, "ignored", { parser, parsedJson, error: result.notice });
    return { status: "ignored", smsId: row.id, reason: result.notice };
  }

  const account = await resolveAccount(db, result);
  if (!account) {
    const error = `no_account:${result.institution}:${result.accountKind}:${result.last4}`;
    await setSmsStatus(db, row.id, "unparsed", { parser, parsedJson, error });
    return { status: "unparsed", smsId: row.id, reason: error };
  }

  const existing = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.smsId, row.id)).get();
  if (existing) {
    await setSmsStatus(db, row.id, "parsed", { parser, parsedJson });
    return { status: "duplicate", smsId: row.id, transactionId: existing.id };
  }

  const rule = findRule(await loadRules(db), result.counterparty, result.vpa);
  const defaultKind = result.direction === "debit" ? "expense" : account.kind === "credit_card" ? "refund" : "income";

  const [txn] = await db
    .insert(transactions)
    .values({
      accountId: account.id,
      occurredAt: result.occurredAt,
      amountPaise: result.amountPaise,
      direction: result.direction,
      kind: rule?.kindOverride ?? defaultKind,
      categoryId: rule?.categoryId ?? null,
      merchant: result.counterparty,
      counterpartyVpa: result.vpa,
      refNo: result.refNo,
      balanceAfterPaise: result.balanceAfterPaise,
      availableLimitPaise: result.availableLimitPaise,
      channel: result.channel,
      source: "sms",
      smsId: row.id,
      // Rule-categorised spends are trusted; everything else gets a glance in the review inbox.
      status: rule?.categoryId ? "confirmed" : "needs_review",
    })
    .onConflictDoNothing({ target: transactions.smsId })
    .returning();

  await setSmsStatus(db, row.id, "parsed", { parser, parsedJson });
  if (!txn) return { status: "duplicate", smsId: row.id };
  if (rule) await bumpRuleHits(db, rule.id);
  await pairTransaction(db, txn.id);
  return { status: "created", smsId: row.id, transactionId: txn.id };
}

async function resolveAccount(db: Db, t: ParsedTxn) {
  return db
    .select({ id: accounts.id, kind: accounts.kind })
    .from(accountNumbers)
    .innerJoin(accounts, eq(accounts.id, accountNumbers.accountId))
    .where(
      and(
        eq(accountNumbers.last4, t.last4),
        eq(accounts.institution, t.institution),
        eq(accounts.kind, t.accountKind),
        eq(accounts.archived, false),
      ),
    )
    .get();
}

function setSmsStatus(
  db: Db,
  id: number,
  parseStatus: SmsRow["parseStatus"],
  extra: { parser?: string; parsedJson?: string; error?: string | null } = {},
) {
  return db
    .update(smsRaw)
    .set({ parseStatus, parser: extra.parser ?? null, parsedJson: extra.parsedJson ?? null, error: extra.error ?? null })
    .where(eq(smsRaw.id, id));
}
