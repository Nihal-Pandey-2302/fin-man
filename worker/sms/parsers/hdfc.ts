import type { ParsedTxn, SmsParser } from "./types";
import { ACCT, AMT, amount, clean, CUR, dmy, last4, occurredAt } from "./util";

// Multi-line:
// "Sent Rs.520.00\nFrom HDFC Bank A/C *4444\nTo HDFC SECURITIES LTD\nOn 27/10/26\nRef 600000000005\nNot You?..."
const UPI_DEBIT = new RegExp(
  String.raw`Sent ${CUR}${AMT}\s+From HDFC Bank A/C ${ACCT}\s+To (.+?)\s+On (\d{2}[/-]\d{2}[/-]\d{2,4})\s+Ref (\d+)`,
  "i",
);

// "Credit Alert!\nRs.1000.00 credited to HDFC Bank A/c XX4444 on 30-10-26 from VPA *llet@phonepe (UPI 600000000006)"
const UPI_CREDIT = new RegExp(
  String.raw`${CUR}${AMT} credited to HDFC Bank A/c ${ACCT} on (\d{2}[/-]\d{2}[/-]\d{2,4}) from VPA (\S+) \(UPI (\d+)\)`,
  "i",
);

const base = {
  type: "txn",
  institution: "HDFC",
  accountKind: "bank",
  channel: "upi",
  balanceAfterPaise: null,
  availableLimitPaise: null,
} as const;

export const hdfcParser: SmsParser = {
  name: "hdfc",
  parse(body, receivedAt): ParsedTxn | null {
    let m = UPI_DEBIT.exec(body);
    if (m) {
      const [, amt, acct, payee, date, ref] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "debit",
        amountPaise: amount(amt),
        counterparty: clean(payee),
        vpa: null,
        refNo: ref,
        occurredAt: occurredAt(dmy(date), undefined, receivedAt),
      };
    }
    m = UPI_CREDIT.exec(body);
    if (m) {
      const [, amt, acct, date, vpa, ref] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "credit",
        amountPaise: amount(amt),
        counterparty: null,
        vpa,
        refNo: ref,
        occurredAt: occurredAt(dmy(date), undefined, receivedAt),
      };
    }
    return null;
  },
};
