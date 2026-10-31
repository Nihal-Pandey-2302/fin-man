import { CalendarRange, Ellipsis, House, ReceiptText, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };

// Order matters: on phones the Add button sits between the 2nd and 3rd item.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/activity", label: "Activity", icon: ReceiptText },
  { to: "/plan", label: "Plan", icon: CalendarRange },
  { to: "/more", label: "More", icon: Ellipsis },
];
