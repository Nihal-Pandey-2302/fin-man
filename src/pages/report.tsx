import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import type { Report } from "@shared/api";
import { formatPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { NativeSelect } from "@/components/native-select";
import { TxnEditor, type EditorTarget } from "@/components/txn-editor";
import { TxnRow } from "@/components/txn-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLookups, useReport } from "@/lib/queries";
import { SubPageHeader } from "./more";

const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export default function ReportPage() {
  const [start, setStart] = useState<string | undefined>();
  const { data: r, isPending, isPlaceholderData } = useReport(start);
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  return (
    <div className="space-y-4">
      <SubPageHeader
        title="Report"
        back="/plan"
        action={
          r && (
            <div className="w-48">
              <NativeSelect aria-label="Period" value={r.startDate} onChange={(e) => setStart(e.target.value)} className="h-9 text-sm">
                {r.periods.map((p) => (
                  <option key={p.startDate} value={p.startDate}>
                    {formatShortDate(p.startDate)} – {formatShortDate(p.endDate)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )
        }
      />
      {isPending || !r ? (
        <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (
        <div className={cn("grid gap-4 lg:grid-cols-2", isPlaceholderData && "opacity-60")}>
          <Totals r={r} />
          <Categories r={r} />
          <Card>
            <CardHeader>
              <CardTitle>Top merchants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {r.topMerchants.length === 0 && <p className="text-sm text-muted-foreground">No merchant spends.</p>}
              {r.topMerchants.map((m, i) => (
                <div key={m.merchant} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="flex-1 truncate">{m.merchant}</span>
                  <span className="text-xs text-muted-foreground">{m.count}×</span>
                  <span className="w-24 text-right font-medium tabular-nums">{formatPaise(m.spendPaise)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Biggest spends</CardTitle>
            </CardHeader>
            <CardContent className="-mx-2 px-2">
              {r.biggest.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
              {r.biggest.map((t) => (
                <TxnRow key={t.id} txn={t} onOpen={(txn) => setEditing({ mode: "edit", txn })} />
              ))}
            </CardContent>
          </Card>
        </div>
      )}
      <TxnEditor target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Totals({ r }: { r: Report }) {
  const change = r.previous ? pct(r.spendPaise, r.previous.spendPaise) : null;
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <p className="text-sm text-muted-foreground">Spent</p>
          <p className="text-4xl font-semibold tabular-nums">{formatPaise(r.spendPaise)}</p>
          {change !== null && (
            <p className={cn("mt-1 flex items-center gap-1 text-sm", change > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
              {change > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              {Math.abs(change)}% {change > 0 ? "more" : "less"} than the previous period ({formatPaise(r.previous!.spendPaise)})
            </p>
          )}
        </div>
        <Stat label="Per day" value={formatPaise(Math.round(r.spendPaise / r.daysElapsed))} />
        <Stat label="Income" value={formatPaise(r.incomePaise)} />
        <Stat label="Invested" value={formatPaise(r.investedPaise)} />
        <Stat label="Saved" value={r.incomePaise ? `${Math.round(((r.incomePaise - r.spendPaise) / r.incomePaise) * 100)}%` : "—"} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Categories({ r }: { r: Report }) {
  const { category } = useLookups();
  const max = Math.max(...r.byCategory.map((c) => Math.max(c.spendPaise, c.previousPaise)), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>By category</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {r.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No spending in this period.</p>}
        {r.byCategory.map((c) => {
          const cat = category(c.categoryId);
          const change = pct(c.spendPaise, c.previousPaise);
          return (
            <div key={c.categoryId ?? "none"} className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span>{cat?.emoji ?? "❔"}</span>
                <span className="flex-1 truncate">{cat?.name ?? "Uncategorised"}</span>
                {change !== null && <span className={cn("text-xs", change > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{change > 0 ? `+${change}` : change}%</span>}
                <span className="w-24 text-right tabular-nums">{formatPaise(c.spendPaise)}</span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                {/* previous period as a faint marker behind this period's bar */}
                <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/15" style={{ width: `${(c.previousPaise / max) * 100}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(Math.max(0, c.spendPaise) / max) * 100}%`, backgroundColor: cat?.color ?? "var(--muted-foreground)" }} />
              </div>
            </div>
          );
        })}
        {r.previous && <p className="text-xs text-muted-foreground">Faint bars: {formatShortDate(r.previous.startDate)} – {formatShortDate(r.previous.endDate)}</p>}
      </CardContent>
    </Card>
  );
}
