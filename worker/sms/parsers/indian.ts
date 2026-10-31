import type { ParseResult, SmsParser } from "./types";
import { ACCT, AMT, amount, clean, CUR, dMonY, dmy, last4, occurredAt, ymdString } from "./util";

const SIGNOFF = String.raw`.*-\s*Indian ?Bank`;

// "Your a/c. XXXX7777 is credited by Rs. 99800.00 on 01-08-26 by a/c linked to mobile 9XXXXXX12345
//  (IMPS Ref no. 600000000002). -IndianBank"
const IMPS_CREDIT = new RegExp(
  String.raw`Your a/c\.? ${ACCT} is credited by ${CUR}${AMT} on (\d{2}-\d{2}-\d{2,4}) by (.+?)\s*\(IMPS Ref no\.?\s*(\d+)\)${SIGNOFF}`,
  "is",
);

// "Sent Rs.1578.00 from A/c *7777 on 01-08-26 to RAVI KUMAR.RRN 600000000003.Avl Bal Rs.73156.45.Not you?..."
const UPI_DEBIT = new RegExp(
  String.raw`Sent ${CUR}${AMT} from A/c ${ACCT} on (\d{2}-\d{2}-\d{2,4}) to (.+?)\.\s*RRN (\d+)\.\s*Avl Bal ${CUR}${AMT}${SIGNOFF}`,
  "is",
);

// "Your A/c *7777 is credited with Rs.10000.00 on 29-08-26 by PRIYA SHARMA. RRN 600000000004.
//  Available balance is Rs. 12550.68 - Indian Bank"
const UPI_CREDIT = new RegExp(
  String.raw`Your A/c ${ACCT} is credited with ${CUR}${AMT} on (\d{2}-\d{2}-\d{2,4}) by (.+?)\.\s*RRN (\d+)\.\s*Available balance is ${CUR}${AMT}${SIGNOFF}`,
  "is",
);

// "Your account will be debited with Rs 5781.00 towards Royal Bison Autorent for the Autopay on 07-Aug-26.
//  Pause mandate to stop execution - Indian Bank"
const AUTOPAY_NOTICE = new RegExp(
  String.raw`will be debited with ${CUR}${AMT} towards (.+?) for the Autopay on (\d{1,2}-[A-Za-z]{3}-\d{2,4})${SIGNOFF}`,
  "is",
);

const base = { type: "txn", institution: "INDIAN", accountKind: "bank", vpa: null, availableLimitPaise: null } as const;

export const indianParser: SmsParser = {
  name: "indian",
  parse(body, receivedAt): ParseResult | null {
    let m = UPI_DEBIT.exec(body);
    if (m) {
      const [, amt, acct, date, payee, rrn, bal] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "debit",
        amountPaise: amount(amt),
        channel: "upi",
        counterparty: clean(payee),
        refNo: rrn,
        balanceAfterPaise: amount(bal),
        occurredAt: occurredAt(dmy(date), undefined, receivedAt),
      };
    }
    m = UPI_CREDIT.exec(body);
    if (m) {
      const [, acct, amt, date, payer, rrn, bal] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "credit",
        amountPaise: amount(amt),
        channel: "upi",
        counterparty: clean(payer),
        refNo: rrn,
        balanceAfterPaise: amount(bal),
        occurredAt: occurredAt(dmy(date), undefined, receivedAt),
      };
    }
    m = IMPS_CREDIT.exec(body);
    if (m) {
      const [, acct, amt, date, payer, ref] = m;
      return {
        ...base,
        last4: last4(acct),
        direction: "credit",
        amountPaise: amount(amt),
        channel: "imps",
        // "a/c linked to mobile 9XXXXXX12345" names nobody.
        counterparty: /linked to mobile/i.test(payer) ? null : clean(payer),
        refNo: ref,
        balanceAfterPaise: null,
        occurredAt: occurredAt(dmy(date), undefined, receivedAt),
      };
    }
    m = AUTOPAY_NOTICE.exec(body);
    if (m) {
      const [, amt, payee, date] = m;
      return {
        type: "notice",
        notice: "autopay_upcoming",
        institution: "INDIAN",
        amountPaise: amount(amt),
        payee: clean(payee) ?? payee,
        dueOn: ymdString(dMonY(date)),
      };
    }
    return null;
  },
};
