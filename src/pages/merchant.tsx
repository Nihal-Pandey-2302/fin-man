import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { MerchantDetail } from "@shared/api";
import { formatPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { CategoryBadge, CategoryPicker } from "@/components/category-picker";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { TxnEditor, type EditorTarget } from "@/components/txn-editor";
import { TxnRow } from "@/components/txn-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { post } from "@/lib/api";
import { collapsePairs } from "@/lib/labels";
import { useLedgerMutation, useLookups, useMerchant } from "@/lib/queries";

const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

/** One merchant: every payment, totals, the last 12 months, and which category it's filed under. */
export default function MerchantPage() {
  const { key = "" } = useParams();
  const navigate = useNavigate();
  const { data: m, isPending, isError } = useMerchant(key);
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => (history.length > 1 ? navigate(-1) : navigate("/activity"))} className="-ml-2 rounded-md p-2 pointer-coarse:p-2.5 text-muted-foreground hover:bg-muted" aria-label="Back">
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-heading text-2xl font-semibold">{m?.name ?? (isPending ? "" : "Merchant")}</h1>
      </header>

      {isPending && <Skeleton className="h-64 rounded-xl" />}
      {isError && <p className="py-10 text-center text-sm text-muted-foreground">No payments found for this merchant.</p>}
      {m && (
        <>
          <Summary m={m} />
          <CategoryCard m={m} />
          <Card>
            <CardHeader>
              <CardTitle>
                {m.count} {m.count === 1 ? "payment" : "payments"}
              </CardTitle>
            </CardHeader>
            <CardContent className="-mt-2 px-2">
              {collapsePairs(m.transactions).map((t) => (
                <TxnRow key={t.id} txn={t} onOpen={(txn) => setEditing({ mode: "edit", txn })} />
              ))}
              {m.count > m.transactions.length && <p className="px-2 pt-2 text-xs text-muted-foreground">Showing the latest {m.transactions.length}.</p>}
            </CardContent>
          </Card>
        </>
      )}
      <TxnEditor target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Summary({ m }: { m: MerchantDetail }) {
  const max = Math.max(...m.monthly.map((x) => x.spentPaise), 1);
  const active = m.monthly.filter((x) => x.spentPaise > 0);
  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label={m.receivedPaise > m.spentPaise ? "Received" : "Spent"} value={formatPaise(m.receivedPaise > m.spentPaise ? m.receivedPaise : m.spentPaise)} />
          <Stat label="Average" value={m.avgPaise ? formatPaise(m.avgPaise) : "—"} />
          <Stat label="Per active month" value={active.length ? formatPaise(Math.round(active.reduce((s, x) => s + x.spentPaise, 0) / active.length)) : "—"} />
        </div>
        <div>
          <div className="flex h-24 items-end gap-1" role="img" aria-label="Spending per month, last 12 months">
            {m.monthly.map((x) => (
              <div
                key={x.month}
                title={`${monthLabel.format(new Date(`${x.month}-01`))}: ${formatPaise(x.spentPaise)}`}
                className={x.spentPaise > 0 ? "min-w-0 flex-1 rounded-t-[3px] bg-primary/60" : "min-w-0 flex-1 rounded-t-[3px] bg-muted"}
                style={{ height: x.spentPaise > 0 ? `${Math.max(4, (x.spentPaise / max) * 100)}%` : "3px" }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{monthLabel.format(new Date(`${m.monthly[0].month}-01`))}</span>
            <span>{m.firstOn === m.lastOn ? formatShortDate(m.lastOn) : `${formatShortDate(m.firstOn)} – ${formatShortDate(m.lastOn)}`}</span>
            <span>{monthLabel.format(new Date(`${m.monthly.at(-1)!.month}-01`))}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CategoryCard({ m }: { m: MerchantDetail }) {
  const { category, activeCategories } = useLookups();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [past, setPast] = useState(true);
  const filedAs = category(m.rule?.categoryId ?? m.categoryId);
  const save = useLedgerMutation(
    () => post<{ changed: number }>(`/merchants/${encodeURIComponent(m.key)}/category`, { categoryId: picked, applyToPast: past }),
    (r) => `${m.name} → ${category(picked)?.name}${r.changed ? ` · ${r.changed} past ${r.changed === 1 ? "payment" : "payments"} re-filed` : ""}`,
  );
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <CategoryBadge category={filedAs} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{m.rule ? "New payments are filed under" : "Usually filed under"}</span>
          <span className="block truncate font-medium">{filedAs?.name ?? "Not categorised"}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPicked(filedAs?.id ?? null);
            setOpen(true);
          }}
        >
          Change
        </Button>
      </CardContent>
      <ResponsiveSheet open={open} onOpenChange={setOpen} title={`File ${m.name} under`}>
        {open && (
          <div className="space-y-4 pb-2">
            <CategoryPicker categories={activeCategories} value={picked} onChange={setPicked} direction={m.receivedPaise > m.spentPaise ? "credit" : "debit"} />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Also re-file its {m.count} past {m.count === 1 ? "payment" : "payments"}
              </span>
              <Switch checked={past} onCheckedChange={setPast} />
            </label>
            <Button className="h-11 w-full md:h-9" disabled={!picked || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setOpen(false) })}>
              Save
            </Button>
          </div>
        )}
      </ResponsiveSheet>
    </Card>
  );
}
