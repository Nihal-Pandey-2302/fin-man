import { describe, expect, it } from "vitest";
import { isOtp, isPromo } from "../worker/sms/classify";
import { normalizeBody, normalizeSender, smsHash } from "../worker/sms/normalize";
import { parseSms } from "../worker/sms/parsers";
import { istToUtc } from "../shared/time";

const fixtures = import.meta.glob<string>("./fixtures/sms/**/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
});
const sms = (path: string) => {
  const body = fixtures[`./fixtures/sms/${path}`];
  if (body === undefined) throw new Error(`missing fixture ${path}`);
  return body;
};

// Received the same evening as most samples, so date-only SMS fall back predictably.
const RECEIVED = istToUtc(2026, 10, 31, 21, 0);
const noonIst = (y: number, m: number, d: number) => istToUtc(y, m, d, 12, 0);

const expected: Record<string, ReturnType<typeof parseSms>> = {
  "card/spend_rupay_swiggy.txt": {
    parser: "idfc_card",
    result: {
      type: "txn", institution: "IDFC", accountKind: "credit_card", last4: "1111", direction: "debit",
      amountPaise: 38_000, channel: "card", counterparty: "Swiggy", vpa: null, refNo: null,
      balanceAfterPaise: null, availableLimitPaise: 2_310_986, occurredAt: istToUtc(2026, 10, 31, 20, 28),
    },
  },
  "card/spend_rupay_pitstop.txt": {
    parser: "idfc_card",
    result: {
      type: "txn", institution: "IDFC", accountKind: "credit_card", last4: "1111", direction: "debit",
      amountPaise: 1_000, channel: "card", counterparty: "PITSTOP", vpa: null, refNo: null,
      balanceAfterPaise: null, availableLimitPaise: 2_380_086, occurredAt: istToUtc(2026, 10, 30, 16, 11),
    },
  },
  "card/spend_mastercard_blinkit.txt": {
    parser: "idfc_card",
    result: {
      type: "txn", institution: "IDFC", accountKind: "credit_card", last4: "2222", direction: "debit",
      amountPaise: 68_400, channel: "card", counterparty: "Blinkit", vpa: null, refNo: null,
      balanceAfterPaise: null, availableLimitPaise: 2_472_678, occurredAt: istToUtc(2026, 10, 29, 11, 23),
    },
  },
  "card/spend_mastercard_eternal.txt": {
    parser: "idfc_card",
    result: {
      type: "txn", institution: "IDFC", accountKind: "credit_card", last4: "2222", direction: "debit",
      amountPaise: 62_339, channel: "card", counterparty: "ETERNAL LIMITED", vpa: null, refNo: null,
      balanceAfterPaise: null, availableLimitPaise: 2_381_139, occurredAt: istToUtc(2026, 10, 29, 20, 40),
    },
  },
  "idfc/credit.txt": {
    parser: "idfc",
    result: {
      type: "txn", institution: "IDFC", accountKind: "bank", last4: "3456", direction: "credit",
      amountPaise: 200_000, channel: null, counterparty: null, vpa: null, refNo: null,
      balanceAfterPaise: 336_000, availableLimitPaise: null, occurredAt: istToUtc(2026, 10, 31, 9, 59),
    },
  },
  "idfc/upi_debit.txt": {
    parser: "idfc",
    result: {
      type: "txn", institution: "IDFC", accountKind: "bank", last4: "3456", direction: "debit",
      amountPaise: 239_600, channel: "upi", counterparty: "HEY HABIBI", vpa: null, refNo: "600000000001",
      balanceAfterPaise: 136_000, availableLimitPaise: null, occurredAt: noonIst(2026, 10, 30),
    },
  },
  "indian/imps_credit.txt": {
    parser: "indian",
    result: {
      type: "txn", institution: "INDIAN", accountKind: "bank", last4: "7777", direction: "credit",
      amountPaise: 9_980_000, channel: "imps", counterparty: null, vpa: null, refNo: "600000000002",
      balanceAfterPaise: null, availableLimitPaise: null, occurredAt: noonIst(2026, 8, 1),
    },
  },
  "indian/upi_debit.txt": {
    parser: "indian",
    result: {
      type: "txn", institution: "INDIAN", accountKind: "bank", last4: "7777", direction: "debit",
      amountPaise: 157_800, channel: "upi", counterparty: "RAVI KUMAR", vpa: null, refNo: "600000000003",
      balanceAfterPaise: 7_315_645, availableLimitPaise: null, occurredAt: noonIst(2026, 8, 1),
    },
  },
  "indian/upi_credit.txt": {
    parser: "indian",
    result: {
      type: "txn", institution: "INDIAN", accountKind: "bank", last4: "7777", direction: "credit",
      amountPaise: 1_000_000, channel: "upi", counterparty: "PRIYA SHARMA", vpa: null, refNo: "600000000004",
      balanceAfterPaise: 1_255_068, availableLimitPaise: null, occurredAt: noonIst(2026, 8, 29),
    },
  },
  "indian/autopay_notice.txt": {
    parser: "indian",
    result: {
      type: "notice", notice: "autopay_upcoming", institution: "INDIAN", amountPaise: 578_100,
      payee: "Royal Bison Autorent", dueOn: "2026-08-07",
    },
  },
  "hdfc/upi_debit.txt": {
    parser: "hdfc",
    result: {
      type: "txn", institution: "HDFC", accountKind: "bank", last4: "4444", direction: "debit",
      amountPaise: 52_000, channel: "upi", counterparty: "HDFC SECURITIES LTD", vpa: null, refNo: "600000000005",
      balanceAfterPaise: null, availableLimitPaise: null, occurredAt: noonIst(2026, 10, 27),
    },
  },
  "hdfc/upi_credit.txt": {
    parser: "hdfc",
    result: {
      type: "txn", institution: "HDFC", accountKind: "bank", last4: "4444", direction: "credit",
      amountPaise: 100_000, channel: "upi", counterparty: null, vpa: "*llet@phonepe", refNo: "600000000006",
      balanceAfterPaise: null, availableLimitPaise: null, occurredAt: noonIst(2026, 10, 30),
    },
  },
};

describe("bank SMS parsers (fixtures)", () => {
  it("has an expectation for every bank fixture", () => {
    const bankFixtures = Object.keys(fixtures)
      .map((k) => k.replace("./fixtures/sms/", ""))
      .filter((k) => !k.startsWith("other/"));
    expect(bankFixtures.sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [path, want] of Object.entries(expected)) {
    it(path, () => {
      expect(parseSms(normalizeBody(sms(path)), RECEIVED)).toEqual(want);
    });
  }

  it("uses the receive time for a date-only SMS received that same IST day", () => {
    const received = istToUtc(2026, 10, 27, 18, 5);
    const parsed = parseSms(normalizeBody(sms("hdfc/upi_debit.txt")), received);
    expect(parsed?.result.type === "txn" && parsed.result.occurredAt).toEqual(received);
  });

  it("survives CRLF line endings and trailing spaces", () => {
    const body = sms("hdfc/upi_debit.txt").replace(/\n/g, "  \r\n");
    expect(parseSms(normalizeBody(body), RECEIVED)?.parser).toBe("hdfc");
  });

  it("returns null for SMS it doesn't know", () => {
    expect(parseSms("Your card statement is ready.", RECEIVED)).toBeNull();
    expect(parseSms(normalizeBody(sms("other/synthetic_promo.txt")), RECEIVED)).toBeNull();
  });
});

describe("classification", () => {
  it("spots OTPs", () => {
    expect(isOtp(sms("other/synthetic_otp.txt"))).toBe(true);
    for (const [path] of Object.entries(expected)) expect(isOtp(sms(path)), path).toBe(false);
  });

  it("spots promos only in non-transaction SMS", () => {
    expect(isPromo(sms("other/synthetic_promo.txt"))).toBe(true);
  });
});

describe("normalization", () => {
  it("strips operator prefixes and TRAI suffixes from sender IDs", () => {
    expect(normalizeSender("VM-HDFCBK")).toBe("HDFCBK");
    expect(normalizeSender("ad-hdfcbk-s")).toBe("HDFCBK");
    expect(normalizeSender("JD-IDFCFB-T")).toBe("IDFCFB");
    expect(normalizeSender("IDFCFB")).toBe("IDFCFB");
  });

  it("hashes the same SMS identically across delivery routes", async () => {
    const body = normalizeBody(sms("idfc/credit.txt"));
    const a = await smsHash(normalizeSender("VM-IDFCFB-S"), body);
    const b = await smsHash(normalizeSender("JD-IDFCFB"), normalizeBody(`${body}\r\n`));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
