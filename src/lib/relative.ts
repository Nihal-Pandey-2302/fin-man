const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto", style: "short" });

/** "5 min ago", "3 hr ago", "yesterday", "4 days ago". */
export function relativeTime(at: string | Date | number, now = Date.now()): string {
  const diff = (+new Date(at) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}
