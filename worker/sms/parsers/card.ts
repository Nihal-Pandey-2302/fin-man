import type { SmsParser } from "./types";
import { ACCT, AMT, amount, clean, CUR, dMonY, last4, occurredAt } from "./util";

// IDFC FIRST Bank credit card. The leading phrase varies ("Delicious Purchase!", "Happy Shopping!", ...).
// "INR 380.00 spent on your IDFC FIRST Bank Credit Card ending XX1111 at Swiggy on 31 OCT 2026 at 08:28 PM
//  Avbl Limit: INR 23109.86 ..."
const SPEND = new RegExp(
  String.raw`${CUR}${AMT} spent on your IDFC FIRST Bank Credit Card ending ${ACCT} at (.+?) on (\d{1,2} [A-Za-z]{3} \d{4}) at (\d{1,2}:\d{2}\s*[AP]M)\s+Avbl Limit:\s*${CUR}${AMT}`,
  "i",
);

export const cardParser: SmsParser = {
  name: "idfc_card",
  parse(body, receivedAt) {
    const m = SPEND.exec(body);
    if (!m) return null;
    const [, amt, acct, merchant, date, time, limit] = m;
    return {
      type: "txn",
      institution: "IDFC",
      accountKind: "credit_card",
      last4: last4(acct),
      direction: "debit",
      amountPaise: amount(amt),
      channel: "card",
      counterparty: clean(merchant),
      vpa: null,
      refNo: null,
      balanceAfterPaise: null,
      availableLimitPaise: amount(limit),
      occurredAt: occurredAt(dMonY(date), time, receivedAt),
    };
  },
};
