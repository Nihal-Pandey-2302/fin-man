import { ArrowRight, PiggyBank } from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import type { Savings } from "@shared/api";
import { formatPaise } from "@shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSavings } from "@/lib/queries";

/** Six months of spending is the usual emergency-fund goal. */
const EMERGENCY_GOAL_MONTHS = 6;
const rate = (income: number, spent: number) => (income > 0 ? Math.round(((income - spent) / income) * 100) : null);

/** Home: pay yourself first. This cycle against the savings target, the emergency fund, and goal set-asides. */
export function SavingsCard() {
  const { data: s } = useSavings();
  if (!s) return null;
  const { cycle: c } = s;
  const nothingYet = c.incomePaise === 0 && c.targetPaise === 0 && s.goals.length === 0 && s.emergency.months === null;
  if (nothingYet) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="size-4" /> Savings
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/plan#savings">
            Plan <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <ThisCycle s={s} />
        <Emergency s={s} />
        {s.goalsMonthlyPaise > 0 && (
          <p className="text-xs text-muted-foreground">
            Set aside {formatPaise(s.goalsMonthlyPaise)} this month for {s.goals.filter((g) => g.monthlyNeedPaise > 0).length === 1 ? "your goal" : "your goals"}
            {s.earmarkedPaise > 0 && ` · ${formatPaise(s.earmarkedPaise)} set aside so far`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ThisCycle({ s }: { s: Savings }) {
  const c = s.cycle;
  if (c.incomePaise === 0) {
    return <p className="text-sm text-muted-foreground">Record this cycle's salary to track what you save.</p>;
  }
  const r = rate(c.incomePaise, c.spentPaise);
  const target = c.targetPaise;
  // The budget is what you plan to spend: if income − budget is below the target, the plan itself falls short.
  const short = target > 0 && c.budgetPaise > 0 ? target - c.projectedPaise : 0;
  const past = s.history.slice(0, 3).map((h) => rate(h.incomePaise, h.spentPaise)).filter((x): x is number => x !== null);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Not spent this cycle</p>
          <p className="text-2xl font-semibold tabular-nums">{formatPaise(c.savedSoFarPaise)}</p>
        </div>
        {r !== null && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Savings rate</p>
            <p className="font-semibold tabular-nums">{r}%</p>
          </div>
        )}
      </div>
      {target > 0 ? (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", c.projectedPaise >= target ? "bg-emerald-500" : "bg-amber-500")}
              style={{ width: `${Math.min(100, Math.max(0, (c.projectedPaise / target) * 100))}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {c.budgetPaise > 0 ? (
              short > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  Your budget leaves {formatPaise(Math.max(0, c.projectedPaise))}, {formatPaise(short)} short of the {formatPaise(target)} target.
                </span>
              ) : (
                <>
                  On track: {formatPaise(c.projectedPaise)} saved if you stay within budget (target {formatPaise(target)}).
                </>
              )
            ) : (
              <>Target {formatPaise(target)}. Set a budget to see if you're on track.</>
            )}
          </p>
        </>
      ) : (
        <Link to="/plan#savings" className="text-xs text-muted-foreground underline underline-offset-2">
          Set a savings target
        </Link>
      )}
      {past.length > 0 && <p className="text-xs text-muted-foreground">Previous cycles: {past.map((x) => `${x}%`).join(" · ")}</p>}
    </div>
  );
}

function Emergency({ s }: { s: Savings }) {
  const e = s.emergency;
  if (e.months === null || !e.monthlySpendPaise) return null;
  const tone = e.months >= EMERGENCY_GOAL_MONTHS ? "bg-emerald-500" : e.months >= 3 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="space-y-1.5 border-t pt-3">
      <div className="flex items-baseline justify-between text-sm">
        <span>Emergency fund</span>
        <span className="font-semibold tabular-nums">
          {e.months.toLocaleString("en-IN", { maximumFractionDigits: 1 })} {e.months === 1 ? "month" : "months"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, (e.months / EMERGENCY_GOAL_MONTHS) * 100)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatPaise(e.liquidPaise)} you could live on ÷ {formatPaise(e.monthlySpendPaise)} a month
        {e.basis === "budget" ? " (your budget)" : " (recent spending)"}. Aim for {EMERGENCY_GOAL_MONTHS}.
      </p>
    </div>
  );
}
