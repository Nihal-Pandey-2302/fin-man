import { AlertCircle, ArrowRight, BriefcaseBusiness, CalendarClock, CircleHelp, Inbox } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { cn } from "cn";
import type { Dashboard, Txn } from "@shared/api";
import { formatPaise } from "@shared/money";
import { addDays, daysBetween, formatShortDate } from "@shared/time";
import { AlertBanners } from "@/components/alert-banners";
import { CardBill } from "@/components/card-bill";
import { GettingStarted } from "@/components/getting-started";
import { Money } from "@/components/money";
import { SalaryPlanCard } from "@/components/salary-plan-card";
import { SalarySheet } from "@/components/salary-sheet";
import { TxnEditor, type EditorTarget } from "@/components/txn-editor";
import { TxnRow } from "@/components/txn-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/relative";
import { useDashboard, useLookups, useSalaryPlan } from "@/lib/queries";

export default function HomePage() {
  const { data: d, isPending, isError, refetch } = useDashboard();
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const { data: plan } = useSalaryPlan();
  const showPlan = !!d && !!plan && daysBetween(plan.cycleStart, d.today) <= 5 && plan.items.some((i) => !i.done);
  // The salary sheet lives in the URL (/?salary=1), so the "salary not recorded" alert and push can open it.
  const [params, setParams] = useSearchParams();
  const salaryOpen = params.get("salary") === "1";
  const setSalaryOpen = (open: boolean) => setParams(open ? { salary: "1" } : {}, { replace: !open });

  if (isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6">
          <AlertCircle className="text-destructive" /> Couldn't load the dashboard.
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl font-semibold">Today</h1>
        {d && (
          <span className="text-sm text-muted-foreground">
            Cycle {formatShortDate(d.cycle.startDate)} – {formatShortDate(d.cycle.endDate)}
          </span>
        )}
      </header>

      {d && d.reviewCount > 0 && (
        <Link
          to="/activity/review"
          className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm transition-colors hover:bg-amber-500/15"
        >
          <Inbox className="size-5 text-amber-600 dark:text-amber-400" />
          <span className="flex-1">
            <b>{d.reviewCount}</b> {d.reviewCount === 1 ? "item needs" : "items need"} a quick look
          </span>
          <ArrowRight className="size-4" />
        </Link>
      )}

      {d?.salary.awaiting && (
        <button
          type="button"
          onClick={() => setSalaryOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-left text-sm transition-colors hover:bg-emerald-500/15"
        >
          <BriefcaseBusiness className="size-5 text-emerald-600 dark:text-emerald-400" />
          <span className="flex-1">
            <b>Salary in?</b> Record it to start the new cycle
          </span>
          <ArrowRight className="size-4" />
        </button>
      )}

      {/* The salary prompt above covers the "salary not recorded" alert. */}
      {d && <AlertBanners alerts={d.salary.awaiting ? d.alerts.filter((a) => !a.key.startsWith("salary_missing:")) : d.alerts} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {d && <GettingStarted d={d} />}
          {isPending ? <Skeleton className="h-48 rounded-xl" /> : <SafeToSpend d={d} />}
          {showPlan && <SalaryPlanCard plan={plan} />}
          {/* Empty charts on a fresh install are just noise. */}
          {isPending ? <Skeleton className="h-40 rounded-xl" /> : (d.daily.some((x) => x.spentPaise > 0) || d.cycle.budgetPaise > 0) && <DailyChart d={d} />}
          {isPending ? <Skeleton className="h-64 rounded-xl" /> : d.byCategory.some((c) => c.spentPaise > 0 || c.limitPaise) && <ByCategory d={d} />}
        </div>
        <div className="space-y-4">
          <Balances d={d} loading={isPending} />
          {d && <Upcoming d={d} />}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/activity">
                  See all <ArrowRight />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="-mt-2 px-2">
              {isPending
                ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="my-2 h-12" />)
                : d.recent.length === 0
                  ? <p className="py-4 text-center text-sm text-muted-foreground">No transactions yet.</p>
                  : d.recent.map((t: Txn) => <TxnRow key={t.id} txn={t} onOpen={(txn) => setEditing({ mode: "edit", txn })} />)}
            </CardContent>
          </Card>
        </div>
      </div>
      <TxnEditor target={editing} onClose={() => setEditing(null)} />
      <SalarySheet open={salaryOpen} onOpenChange={setSalaryOpen} />
    </div>
  );
}

function SafeToSpend({ d }: { d: Dashboard }) {
  const c = d.cycle;
  if (c.budgetPaise === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <p className="text-sm text-muted-foreground">Spent this cycle</p>
          <p className="text-4xl font-semibold tabular-nums">{formatPaise(c.spentPaise)}</p>
          <p className="text-sm text-muted-foreground">Set a budget for this cycle to see how much is safe to spend each day.</p>
          <Button asChild>
            <Link to="/plan">Set cycle budget</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  const over = c.leftTodayPaise < 0;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / c.budgetPaise) * 100))}%`;
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 py-5">
        <div>
          <p className="text-sm text-muted-foreground">{over ? "Over today's allowance by" : "Safe to spend today"}</p>
          <p className={cn("text-5xl font-semibold tracking-tight tabular-nums", over && "text-destructive")}>
            {formatPaise(Math.abs(c.leftTodayPaise))}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPaise(c.dailyAllowancePaise)}/day · {c.daysLeft} {c.daysLeft === 1 ? "day" : "days"} left · spent {formatPaise(c.spentTodayPaise)} today
          </p>
        </div>
        <div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Cycle budget used">
            <div className="bg-primary transition-all" style={{ width: pct(c.spentPaise) }} />
            <div className="bg-amber-500/70 transition-all" style={{ width: pct(c.autopaysDuePaise) }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="mr-1 inline-block size-2 rounded-full bg-primary" />
              Spent {formatPaise(c.spentPaise)}
            </span>
            {c.autopaysDuePaise > 0 && (
              <span>
                <span className="mr-1 inline-block size-2 rounded-full bg-amber-500/70" />
                Autopays due {formatPaise(c.autopaysDuePaise)}
              </span>
            )}
            <span className="ml-auto">
              {c.remainingPaise >= 0 ? `${formatPaise(c.remainingPaise)} left` : `${formatPaise(-c.remainingPaise)} over`} of {formatPaise(c.budgetPaise)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** One bar per day of the whole cycle; days still to come are faint stubs, so the chart also shows how far in you are. */
function DailyChart({ d }: { d: Dashboard }) {
  const allowance = d.cycle.dailyAllowancePaise;
  const length = Math.min(45, Math.max(1, daysBetween(d.cycle.startDate, d.cycle.endDate) + 1));
  const byDate = new Map(d.daily.map((x) => [x.date, x.spentPaise]));
  const series = Array.from({ length }, (_, i) => {
    const date = addDays(d.cycle.startDate, i);
    return { date, paise: Math.max(0, byDate.get(date) ?? 0), future: date > d.today };
  });
  const past = series.filter((s) => !s.future);
  const max = Math.max(allowance, ...past.map((s) => s.paise), 1);
  const overDays = allowance > 0 ? past.filter((s) => s.paise > allowance).length : 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between">
        <CardTitle>Daily spend</CardTitle>
        <span className="text-xs text-muted-foreground">
          {overDays > 0 ? `${overDays} of ${past.length} ${past.length === 1 ? "day" : "days"} over` : `${past.length} of ${length} days in`}
        </span>
      </CardHeader>
      <CardContent>
        <div className="relative flex h-28 items-end gap-[2px]">
          {allowance > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
              style={{ bottom: `${(allowance / max) * 100}%` }}
            />
          )}
          {series.map((s) => (
            <div
              key={s.date}
              title={s.future ? formatShortDate(s.date) : `${formatShortDate(s.date)}: ${formatPaise(s.paise)}`}
              className={cn(
                "min-w-0 flex-1 rounded-t-[3px] transition-[height]",
                s.future ? "bg-muted" : allowance > 0 && s.paise > allowance ? "bg-destructive/75" : s.date === d.today ? "bg-primary" : "bg-primary/40",
              )}
              style={{ height: s.future ? "3px" : `${Math.max(3, (s.paise / max) * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{formatShortDate(series[0].date)}</span>
          {allowance > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 border-t border-dashed border-muted-foreground" /> {formatPaise(allowance)}/day
            </span>
          )}
          <span>{formatShortDate(series[series.length - 1].date)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ByCategory({ d }: { d: Dashboard }) {
  const { category } = useLookups();
  const rows = d.byCategory.filter((c) => c.spentPaise > 0 || c.limitPaise);
  const max = Math.max(...rows.map((r) => Math.max(r.spentPaise, r.limitPaise ?? 0)), 1);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Where it went</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/plan/report">
            Report <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No spending this cycle yet.</p>}
        {rows.slice(0, 8).map((r) => {
          const cat = category(r.categoryId);
          const over = r.limitPaise != null && r.spentPaise > r.limitPaise;
          return (
            <div key={r.categoryId ?? "none"} className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex w-5 justify-center">{cat?.emoji ?? <CircleHelp className="size-4 text-muted-foreground" />}</span>
                <span className="flex-1 truncate">{cat?.name ?? "Uncategorised"}</span>
                <span className={cn("tabular-nums", over && "text-destructive")}>
                  {formatPaise(r.spentPaise)}
                  {r.limitPaise != null && <span className="text-muted-foreground"> / {formatPaise(r.limitPaise)}</span>}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", over ? "bg-destructive" : "")}
                  style={{ width: `${(r.spentPaise / max) * 100}%`, backgroundColor: over ? undefined : (cat?.color ?? "var(--muted-foreground)") }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Balances({ d, loading }: { d?: Dashboard; loading: boolean }) {
  const { activeAccounts } = useLookups();
  const banks = activeAccounts.filter((a) => a.kind !== "credit_card");
  if (loading) return <Skeleton className="h-56 rounded-xl" />;
  // No accounts yet: the getting-started card leads there.
  if (activeAccounts.length === 0) return null;
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Balances</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/more/accounts">Manage</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {banks.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.balance.asOf ? relativeTime(a.balance.asOf) : "not set"}</span>
              <Money paise={a.balance.balancePaise} className="w-28 text-right font-medium" />
            </div>
          ))}
          {d && (
            <div className="flex items-center justify-between border-t pt-2.5 text-sm">
              <span className="text-muted-foreground">{d.bufferPaise > 0 ? "Free after buffer" : "Total"}</span>
              <Money paise={d.liquidPaise - d.bufferPaise} className="font-semibold" />
            </div>
          )}
        </CardContent>
      </Card>
      {d?.cards.map((status) => <CardBill key={status.accountId} status={status} />)}
    </>
  );
}

function Upcoming({ d }: { d: Dashboard }) {
  if (d.upcomingAutopays.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" /> Autopays this cycle
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/plan">Plan</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {d.upcomingAutopays.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className="w-14 text-xs text-muted-foreground">{formatShortDate(a.dueOn)}</span>
            <span className="flex-1 truncate">{a.name}</span>
            <Money paise={a.amountPaise} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
