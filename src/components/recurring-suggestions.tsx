import { Repeat } from "lucide-react";
import type { Recurring } from "@shared/api";
import { formatPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/api";
import { useLedgerMutation, useLookups, useRecurring } from "@/lib/queries";

const PER = { monthly: "/month", quarterly: "/quarter", yearly: "/year" } as const;

/**
 * Plan → Autopays: payments that repeat but aren't tracked yet. "Track" turns one into an autopay (so it's
 * kept out of safe-to-spend and marked paid when it comes); "Not recurring" stops the suggestion.
 */
export function RecurringSuggestions() {
  const { data } = useRecurring();
  const { account } = useLookups();
  const track = useLedgerMutation(
    (r: Recurring) =>
      post("/autopays", {
        name: r.merchant,
        kind: "subscription",
        accountId: r.accountId,
        categoryId: r.categoryId,
        amountPaise: r.amountPaise,
        frequency: r.frequency,
        dayOfMonth: Number(r.lastOn.slice(8)),
        nextDueOn: r.nextOn,
        matchHint: r.key,
      }),
    "Tracking it as an autopay",
  );
  const dismiss = useLedgerMutation((r: Recurring) => post("/recurring/dismiss", { key: r.key }));
  if (!data?.found.length) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Repeat className="size-4" /> Looks recurring · {formatPaise(data.foundMonthlyPaise)}/month
      </p>
      <p className="text-xs text-muted-foreground">
        Not tracked yet. With your bills, EMIs and subscriptions (SIPs aside), that's about {formatPaise(data.trackedMonthlyPaise + data.foundMonthlyPaise)} a month going out.
      </p>
      {data.found.map((r) => (
        <div key={r.key} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{r.merchant}</span>
            <span className="shrink-0 text-sm tabular-nums">
              {formatPaise(r.amountPaise)}
              <span className="text-muted-foreground">{PER[r.frequency]}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {r.count} payments from {account(r.accountId)?.name ?? "an account"} · last {formatShortDate(r.lastOn)} · next around {formatShortDate(r.nextOn)}
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="h-8" disabled={track.isPending} onClick={() => track.mutate(r)}>
              Track
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r)}>
              Not recurring
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
