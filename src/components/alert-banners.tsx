import { AlertTriangle, BellRing, Info, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import type { Alert } from "@shared/api";
import { istDate } from "@shared/time";
import { load, save } from "@/lib/storage";

const STYLE = {
  danger: "border-destructive/40 bg-destructive/10 [&_svg]:text-destructive",
  warn: "border-amber-500/30 bg-amber-500/10 [&_svg]:text-amber-600 dark:[&_svg]:text-amber-400",
  info: "border-border bg-muted/40 [&_svg]:text-muted-foreground",
} as const;
const ICON = { danger: AlertTriangle, warn: BellRing, info: Info } as const;

/** Today's alerts; dismissing hides an alert until it changes (its key includes the date/amount it's about). */
export function AlertBanners({ alerts }: { alerts: Alert[] }) {
  const [dismissed, setDismissed] = useState<Record<string, string>>(() => load("dismissedAlerts", {}));
  const visible = alerts.filter((a) => !dismissed[a.key]);
  if (!visible.length) return null;
  const dismiss = (key: string) => {
    // Keep only recent dismissals so storage doesn't grow forever.
    const today = istDate();
    const next = Object.fromEntries(Object.entries({ ...dismissed, [key]: today }).filter(([, d]) => d >= today.slice(0, 7)));
    setDismissed(next);
    save("dismissedAlerts", next);
  };
  return (
    <div className="space-y-2">
      {visible.map((a) => {
        const Icon = ICON[a.level];
        const body = (
          <>
            <Icon className="mt-0.5 size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{a.title}</span>
              <span className="block text-muted-foreground">{a.body}</span>
            </span>
          </>
        );
        return (
          <div key={a.key} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", STYLE[a.level])}>
            {a.href ? (
              <Link to={a.href} className="flex min-w-0 flex-1 items-start gap-3">
                {body}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
            )}
            <button type="button" onClick={() => dismiss(a.key)} aria-label="Dismiss" className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-background/50">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
