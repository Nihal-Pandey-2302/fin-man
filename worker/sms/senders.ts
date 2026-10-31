// Sender allowlist. PROVISIONAL: the owner will send the exact sender IDs from their phone; until then these
// are the well-known DLT headers, and a bank signature in the body also counts (see `isBankSms`).
// Normalized form (see normalizeSender): no operator prefix, no -S/-T suffix.
export const KNOWN_SENDERS = new Set(["HDFCBK", "HDFCBN", "IDFCFB", "IDFCBK", "INDBNK", "INDIAN"]);

const BANK_SIGNATURE = /HDFC Bank|IDFC FIRST|Indian ?Bank/i;

export function isBankSms(sender: string, body: string): boolean {
  return KNOWN_SENDERS.has(sender) || BANK_SIGNATURE.test(body);
}
