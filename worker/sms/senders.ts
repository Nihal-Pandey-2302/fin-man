// Sender allowlist: the owner's bank sender IDs as their phone shows them (2026-11-01):
// AX-/AD-/CP-IDFCFB-S (IDFC FIRST bank + credit card), BV-/VM-INDBNK-S/-T (Indian Bank), JK-HDFCBK-S (HDFC).
// Normalized form (see normalizeSender): no operator prefix, no -S/-T suffix.
export const KNOWN_SENDERS = new Set(["IDFCFB", "INDBNK", "HDFCBK"]);

const BANK_SIGNATURE = /HDFC Bank|IDFC FIRST|Indian ?Bank/i;

/** A sender on the allowlist: its SMS are parsed automatically. */
export const isKnownSender = (sender: string) => KNOWN_SENDERS.has(sender);

/**
 * An unknown sender whose text names one of the banks (a new sender ID, or a scam). Kept for the review
 * inbox but never parsed automatically, so a look-alike message can't create a transaction on its own.
 */
export const looksLikeBank = (body: string) => BANK_SIGNATURE.test(body);
