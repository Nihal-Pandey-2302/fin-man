import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import type { Dashboard } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLookups } from "@/lib/queries";
import { load, save } from "@/lib/storage";

/** First-run checklist on Home. Steps tick themselves off from real data; it disappears once all are done. */
export function GettingStarted({ d }: { d: Dashboard }) {
  const { activeAccounts, settings } = useLookups();
  const [hidden, setHidden] = useState(() => load("setupHidden", false));
  if (!settings) return null;
  const steps = [
    { done: activeAccounts.length > 0, title: "Add your accounts", body: "With the last 4 digits your SMS show", to: "/more/accounts" },
    { done: settings.owner_names.length > 0, title: "Tell it your name", body: "So own-account transfers aren't spending", to: "/more/settings" },
    { done: d.cycle.budgetPaise > 0, title: "Set this cycle's budget", body: "Unlocks safe-to-spend for each day", to: "/plan" },
    { done: d.lastSmsAt !== null, title: "Forward bank SMS from your phone", body: "Via MacroDroid, or import a backup", to: "/more/settings" },
  ];
  const left = steps.filter((s) => !s.done).length;
  // Accounts are the one step nothing works without, so the card can only be hidden after that.
  if (left === 0 || (hidden && steps[0].done)) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Get set up</CardTitle>
          <CardDescription>
            {steps.length - left} of {steps.length} done
          </CardDescription>
        </div>
        {steps[0].done && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              save("setupHidden", true);
              setHidden(true);
            }}
          >
            Hide
          </Button>
        )}
      </CardHeader>
      <CardContent className="-mt-2 px-2">
        {steps.map((s) => (
          <Link key={s.title} to={s.to} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60">
            {s.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", s.done ? "text-muted-foreground line-through decoration-1" : "font-medium")}>{s.title}</span>
              {!s.done && <span className="block truncate text-xs text-muted-foreground">{s.body}</span>}
            </span>
            {!s.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
