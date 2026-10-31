// IST (Asia/Kolkata, UTC+05:30, no DST) helpers shared by the Worker and the SPA.
// Instants are Date/epoch ms in UTC; calendar dates are "YYYY-MM-DD" strings in IST.

export const TZ = "Asia/Kolkata";
export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** IST calendar date of an instant. */
export function istDate(at: Date | number = Date.now()): string {
  return new Date(+at + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant of an IST wall-clock time. `month` is 1–12. */
export function istToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS);
}

export function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/** Start of an IST calendar day as an instant. */
export function istDayStart(date: string): Date {
  const { y, m, d } = parseDate(date);
  return istToUtc(y, m, d);
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Same day-of-month `months` later, clamped to the month's length (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, months: number, dayOfMonth?: number): string {
  const { y, m, d } = parseDate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(dayOfMonth ?? d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The next date on or after `from` that falls on `dayOfMonth` (clamped to short months). */
export function nextDayOfMonth(from: string, dayOfMonth: number): string {
  const { y, m } = parseDate(from);
  const thisMonth = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, 0, dayOfMonth);
  return thisMonth >= from ? thisMonth : addMonths(thisMonth, 1, dayOfMonth);
}

// ---- display ----
const dayMonth = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const time = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

export function formatTime(at: Date | number): string {
  return time.format(at);
}

/** "Today" / "Yesterday" / "Tue, 28 Oct" / "28 Oct 2025" (other years). */
export function formatDay(at: Date | number | string, today = istDate()): string {
  const date = typeof at === "string" ? at : istDate(at);
  const diff = daysBetween(date, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const instant = istDayStart(date).getTime() + 12 * 3_600_000;
  if (date.slice(0, 4) !== today.slice(0, 4)) return dayMonthYear.format(instant);
  return diff > 0 && diff < 7 ? weekday.format(instant) : dayMonth.format(instant);
}

export function formatShortDate(date: string): string {
  return dayMonth.format(istDayStart(date).getTime() + 12 * 3_600_000);
}
