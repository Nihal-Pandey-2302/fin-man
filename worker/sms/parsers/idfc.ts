import type { ParsedTxn, SmsParser } from "./types";
import { ACCT, AMT, amount, clean, CUR, dmy, last4, occurredAt } from "./util";

// "Your A/C XXXXX123456 is credited with INR 2,000.00 on 31/10/26 09:59. Your new balance is INR 3,360.00.
//  Team IDFC FIRST Bank"
const CREDIT = new RegExp(
  String.raw`Your A/C ${ACCT} is credited with ${CUR}${AMT} on (\d{2}/\d{2}/\d{2,4})(?: (\d{1,2}:\d{2}))?\.\s*Your new balance is ${CUR}${AMT}.*IDFC FIRST`,
  "is",
);

// "Your A/c XX3456 debited by Rs. 2,396.00 on 30/10/26; HEY HABIBI credited. RRN 600000000001.
//  Available balance Rs. 1,360.00. Team IDFC FIRST Bank"
const UPI_DEBIT = new RegExp(
  String.raw`Your A/c ${ACCT} debited by ${CUR}${AMT} on (\d{2}/\d{2}/\d{2,4})(?: (\d{1,2}:\d{2}))?;\s*(.+?) credited\.\s*RRN (\d+)\.\s*Available balance ${CUR}${AMT}.*IDFC FIRST`,
  "is",
);

// "Your A/C XXXXX123456 is debited by INR 2,345.67 on 04/11/26 19:06. New Bal :INR 1,111.11. Call us on
//  180010888 for dispute. Team IDFC FIRST Bank" (no payee: e.g. a card bill paid from the IDFC app)
const DEBIT = new RegExp(
  String.raw`Your A/C ${ACCT} is debited by ${CUR}${AMT} on (\d{2}/\d{2}/\d{2,4})(?: (\d{1,2}:\d{2}))?\.\s*New Bal\s*:\s*${CUR}${AMT}.*IDFC FIRST`,
  "is",
);

const base = { type: "txn", institution: "IDFC", accountKind: "bank", vpa: null, availableLimitPaise: null } as const;

export const idfcParser: SmsParser = {
  name: "idfc",
  parse(body, receivedAt): ParsedTxn | null {
    let m = CREDIT.exec(body);
    if (m) {
      const [, acct, amt, date, time, bal] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "credit",
        amountPaise: amount(amt),
        channel: null,
        counterparty: null,
        refNo: null,
        balanceAfterPaise: amount(bal),
        occurredAt: occurredAt(dmy(date), time, receivedAt),
      };
    }
    m = DEBIT.exec(body);
    if (m) {
      const [, acct, amt, date, time, bal] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "debit",
        amountPaise: amount(amt),
        channel: null,
        counterparty: null,
        refNo: null,
        balanceAfterPaise: amount(bal),
        occurredAt: occurredAt(dmy(date), time, receivedAt),
      };
    }
    m = UPI_DEBIT.exec(body);
    if (m) {
      const [, acct, amt, date, time, payee, rrn, bal] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "debit",
        amountPaise: amount(amt),
        channel: "upi",
        counterparty: clean(payee),
        refNo: rrn,
        balanceAfterPaise: amount(bal),
        occurredAt: occurredAt(dmy(date), time, receivedAt),
      };
    }
    return null;
  },
};
