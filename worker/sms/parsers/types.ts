import type { CHANNELS } from "../../db/schema";

export type Channel = (typeof CHANNELS)[number];
export type BankInstitution = "HDFC" | "IDFC" | "INDIAN";

/** A money movement described by one SMS. */
export type ParsedTxn = {
  type: "txn";
  institution: BankInstitution;
  accountKind: "bank" | "credit_card";
  last4: string;
  direction: "debit" | "credit";
  amountPaise: number;
  channel: Channel | null;
  /** Merchant or person on the other side, as written in the SMS. */
  counterparty: string | null;
  vpa: string | null;
  refNo: string | null;
  balanceAfterPaise: number | null;
  availableLimitPaise: number | null;
  occurredAt: Date;
};

/** Informational SMS worth keeping structured (not a transaction). */
export type ParsedNotice = {
  type: "notice";
  notice: "autopay_upcoming";
  institution: BankInstitution;
  amountPaise: number;
  payee: string;
  /** IST date the debit is scheduled for. */
  dueOn: string;
};

export type ParseResult = ParsedTxn | ParsedNotice;

export type SmsParser = {
  name: string;
  /** Returns null when the body isn't a format this parser knows. */
  parse(body: string, receivedAt: Date): ParseResult | null;
};
