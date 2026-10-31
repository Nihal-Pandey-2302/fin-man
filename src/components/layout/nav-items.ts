import { CalendarRange, Ellipsis, House, Landmark, PiggyBank, ReceiptText, Settings, Tags, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };

// Order matters: on phones the Add button sits between the 2nd and 3rd item.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/activity", label: "Activity", icon: ReceiptText },
  { to: "/plan", label: "Plan", icon: CalendarRange },
  { to: "/more", label: "More", icon: Ellipsis },
];

/** Laptop sidebar shows the "More" pages directly. */
export const SIDEBAR_EXTRA: NavItem[] = [
  { to: "/more/accounts", label: "Accounts", icon: Landmark },
  { to: "/more/categories", label: "Categories & rules", icon: Tags },
  { to: "/more/holdings", label: "Holdings", icon: PiggyBank },
  { to: "/more/settings", label: "Settings", icon: Settings },
];
