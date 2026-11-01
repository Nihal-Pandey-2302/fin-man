// Merchant names as one key, shared by the Worker (merchant rules, recurring payments, merchant pages) and
// the SPA (links to /merchant/<key>).

const SUFFIXES = /\b(?:pvt|private|ltd|limited|llp|india|inc|co)\b\.?/g;

/** Stable rule key for a merchant name: "HDFC SECURITIES LTD" → "hdfc securities", "ETERNAL LIMITED" → "eternal". */
export function ruleKey(merchant: string): string {
  const key = merchant
    .toLowerCase()
    .replace(/[^a-z0-9@._\s-]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key || merchant.toLowerCase().trim();
}

/** Where a merchant's page lives. */
export const merchantPath = (merchant: string) => `/merchant/${encodeURIComponent(ruleKey(merchant))}`;
