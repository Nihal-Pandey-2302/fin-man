import { ChevronRight, Landmark, PiggyBank, Settings, Tags } from "lucide-react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";

const LINKS = [
  { to: "/more/accounts", icon: Landmark, title: "Accounts", text: "Banks, card numbers, balances" },
  { to: "/more/categories", icon: Tags, title: "Categories & rules", text: "How merchants get categorised" },
  { to: "/more/holdings", icon: PiggyBank, title: "Holdings", text: "Mutual funds, stocks, FD, PPF" },
  { to: "/more/settings", icon: Settings, title: "Settings", text: "SMS setup, presets, theme, backup" },
];

export default function MorePage() {
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl font-semibold">More</h1>
      <Card className="gap-0 divide-y py-0">
        {LINKS.map(({ to, icon: Icon, title, text }) => (
          <Link key={to} to={to} className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/50">
            <Icon className="size-5 text-muted-foreground" />
            <span className="flex-1">
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{text}</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>
    </div>
  );
}

export function SubPageHeader({ title, back = "/more", action }: { title: string; back?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-2">
      <Link to={back} className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Back">
        <ChevronRight className="size-5 rotate-180" />
      </Link>
      <h1 className="flex-1 font-heading text-2xl font-semibold">{title}</h1>
      {action}
    </header>
  );
}
