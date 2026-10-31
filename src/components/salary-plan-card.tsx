import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { SalaryPlan } from "@shared/api";
import { formatPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { post } from "@/lib/api";
import { invalidateLedger, useLookups } from "@/lib/queries";

/**
 * Salary-day checklist: what to move where. Steps tick themselves off when the transfer SMS arrive;
 * "Record" logs the transfer by hand (e.g. if an SMS never came).
 */
export function SalaryPlanCard({ plan }: { plan: SalaryPlan }) {
  const { account } = useLookups();
  const [busy, setBusy] = useState<string | null>(null);
  const salary = account(plan.salaryAccountId);
  const record = async (item: SalaryPlan["items"][number]) => {
    setBusy(item.key);
    try {
      await post("/transfers", { fromAccountId: item.fromAccountId, toAccountId: item.toAccountId, amountPaise: item.needPaise, note: item.label });
      toast.success(`Recorded ${formatPaise(item.needPaise)} → ${account(item.toAccountId)?.name}`);
      invalidateLedger();
    } finally {
      setBusy(null);
    }
  };
  if (!salary || plan.items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Salary-day plan</CardTitle>
        <CardDescription>
          {plan.salaryPaise ? `${formatPaise(plan.salaryPaise)} salary · ` : ""}cycle from {formatShortDate(plan.cycleStart)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.items.map((item) => (
          <div key={item.key} className="flex items-center gap-3">
            {item.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className={item.done ? "text-muted-foreground line-through decoration-1" : "font-medium"}>{item.label}</p>
              <p className="truncate text-xs text-muted-foreground">
                {salary.name} <ArrowRight className="inline size-3 align-[-2px]" /> {account(item.toAccountId)?.name}
                {item.sentPaise > 0 && ` · sent ${formatPaise(item.sentPaise)}`}
              </p>
            </div>
            {item.done ? (
              <span className="text-sm text-muted-foreground">Done</span>
            ) : (
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                <span className="font-semibold tabular-nums">{formatPaise(item.needPaise)}</span>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs sm:h-8 sm:px-3 sm:text-sm" disabled={busy === item.key} onClick={() => record(item)}>
                  Record
                </Button>
              </div>
            )}
          </div>
        ))}
        <div className="flex justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Stays in {salary.name}</span>
          <span className={plan.keepPaise < 0 ? "font-semibold text-destructive tabular-nums" : "font-semibold tabular-nums"}>{formatPaise(plan.keepPaise)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
