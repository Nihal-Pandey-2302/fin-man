export const EXPENSE_CATEGORIES = [
  { key: "food", label: "Food", emoji: "🍔", colorClass: "text-orange-400" },
  { key: "transport", label: "Transport", emoji: "🚗", colorClass: "text-blue-400" },
  { key: "shopping", label: "Shopping", emoji: "🛍️", colorClass: "text-purple-400" },
  { key: "subscription", label: "Subscription", emoji: "📱", colorClass: "text-cyan-400" },
  { key: "emi", label: "EMI", emoji: "🏦", colorClass: "text-red-400" },
  { key: "health", label: "Health", emoji: "💊", colorClass: "text-green-400" },
  { key: "education", label: "Education", emoji: "📚", colorClass: "text-yellow-300" },
  { key: "investment", label: "Investment", emoji: "📈", colorClass: "text-emerald-400" },
  { key: "misc", label: "Misc", emoji: "⚪", colorClass: "text-zinc-300" },
] as const;

export const BILLING_CYCLES = ["monthly", "quarterly", "yearly"] as const;

export function categoryMeta(category: string) {
  return (
    EXPENSE_CATEGORIES.find((item) => item.key === category) ?? {
      key: "misc",
      label: "Misc",
      emoji: "⚪",
      colorClass: "text-zinc-300",
    }
  );
}

export function advanceDateByCycle(dateIso: string, cycle: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);

  if (cycle === "quarterly") {
    date.setUTCMonth(date.getUTCMonth() + 3);
  } else if (cycle === "yearly") {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
  } else {
    date.setUTCMonth(date.getUTCMonth() + 1);
  }

  return date.toISOString().slice(0, 10);
}
