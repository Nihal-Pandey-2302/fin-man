// Money helpers shared by the Worker and the SPA. Amounts are integer paise everywhere;
// floats appear only at the display edge (Intl formatting).

const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;

/** "1,23,456.78" | "2,000.00" | "500" | "380.5" → paise. Null if not a clean amount. Never uses floats. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!AMOUNT_RE.test(s)) return null;
  const [rupees, fraction = ""] = s.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

const fmt2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** ₹1,23,456.78 — decimals only when there are paise (unless `exact`). */
export function formatPaise(paise: number, opts: { exact?: boolean; compact?: boolean } = {}): string {
  const rupees = paise / 100;
  if (opts.compact && Math.abs(paise) >= 1_00_000_00) return fmtCompact.format(rupees);
  return opts.exact || paise % 100 !== 0 ? fmt2.format(rupees) : fmt0.format(rupees);
}

/** Signed display for a ledger row: debits negative, credits positive. */
export function signedPaise(amountPaise: number, direction: "debit" | "credit"): number {
  return direction === "debit" ? -amountPaise : amountPaise;
}
