import { rupeesToPaise } from "../../../shared/money";
import { istDate, istToUtc } from "../../../shared/time";

/** Amount token: "2,000.00", "1578.00", "23109.86", "6120". Stops before a sentence-ending period. */
export const AMT = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
/** Currency prefix: "INR ", "Rs.", "Rs. ", "Rs ". */
export const CUR = String.raw`(?:INR|Rs\.?)\s*`;
/** Masked account/card number; captures the visible digits ("XXXXX123456" → "123456", "*4444" → "4444"). */
export const ACCT = String.raw`[*xX]*(\d{3,})`;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function amount(s: string): number {
  const paise = rupeesToPaise(s);
  if (paise === null) throw new Error(`bad amount: ${s}`);
  return paise;
}

export const last4 = (digits: string) => digits.slice(-4);

export function clean(s: string | undefined): string | null {
  const v = s?.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  return v ? v : null;
}

type Ymd = { y: number; m: number; d: number };
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** "31/10/26", "01-08-26", "31/10/2026" (day first, as Indian banks write it). */
export function dmy(s: string): Ymd {
  const [d, m, y] = s.split(/[/-]/);
  return { y: year(y), m: Number(m), d: Number(d) };
}

/** "31 OCT 2026", "07-Aug-26". */
export function dMonY(s: string): Ymd {
  const [d, mon, y] = s.split(/[\s-]+/);
  const m = MONTHS.indexOf(mon.slice(0, 3).toUpperCase()) + 1;
  if (!m) throw new Error(`bad month: ${s}`);
  return { y: year(y), m, d: Number(d) };
}

/** "08:28 PM", "09:59" → 24h hours/minutes. */
export function hm(s: string): { h: number; min: number } {
  const match = /(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(s);
  if (!match) throw new Error(`bad time: ${s}`);
  let h = Number(match[1]);
  const pm = match[3]?.toUpperCase();
  if (pm === "PM" && h < 12) h += 12;
  if (pm === "AM" && h === 12) h = 0;
  return { h, min: Number(match[2]) };
}

export const ymdString = ({ y, m, d }: Ymd) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * When the SMS was sent. With a time → exact IST instant. Date only → the receive time if it falls on
 * that IST date (the usual case), otherwise noon IST that day (keeps it on the right calendar day).
 */
export function occurredAt(date: Ymd, time: string | undefined, receivedAt: Date): Date {
  if (time) {
    const { h, min } = hm(time);
    return istToUtc(date.y, date.m, date.d, h, min);
  }
  if (istDate(receivedAt) === ymdString(date)) return receivedAt;
  return istToUtc(date.y, date.m, date.d, 12, 0);
}
