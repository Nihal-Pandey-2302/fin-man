/**
 * DLT sender headers look like `VM-HDFCBK`, `AD-HDFCBK-S`, `JD-IDFCFB-T`: a 2-letter operator/circle prefix,
 * the 6-char header, and (since 2025) a TRAI category suffix (-S/-T/-P/-G). Keep only the header so the same
 * SMS hashes identically whichever route delivered it.
 */
export function normalizeSender(raw: string): string {
  const s = raw.trim().toUpperCase();
  const m = /^(?:[A-Z]{2}-)?([A-Z0-9]{3,})(?:-[A-Z])?$/.exec(s);
  return m ? m[1] : s;
}

/**
 * A mis-set forwarding app can paste its own "Bearer <token>" header after the SMS text (it happened once).
 * It's never part of a bank message: drop it so the secret isn't stored and the hash stays the bank's text.
 */
const FORWARDING_TOKEN = /(?:\s*Bearer\s+[A-Za-z0-9_-]{16,})+\s*$/;

/** CRLF → LF, trim trailing spaces on each line and the whole body, drop a pasted forwarding token. */
export function normalizeBody(raw: string): string {
  return raw
    .replace(FORWARDING_TOKEN, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Idempotency key: SHA-256 hex of normalized sender + "\n" + normalized body. */
export async function smsHash(sender: string, body: string): Promise<string> {
  const data = new TextEncoder().encode(`${sender}\n${body}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
