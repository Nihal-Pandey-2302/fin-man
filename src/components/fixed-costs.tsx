import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { patch } from "@/lib/api";
import { paiseToInput } from "@/lib/format";
import { useAutopayCalendar, useDashboard, useLedgerMutation, useLookups } from "@/lib/queries";

/**
 * Plan → This cycle: fixed monthly costs (rent…) set aside from the budget before the daily number is worked
 * out, with the sum spelled out so the maths can be checked. Each is matched by category, from any account.
 */
export function FixedCosts() {
  const { data: d } = useDashboard();
  const { data: occurrences } = useAutopayCalendar();
  const { category } = useLookups();
  const [editing, setEditing] = useState(false);
  if (!d) return null;
  const autopays = (occurrences ?? []).filter((o) => o.kind !== "sip");
  const autopayTotal = autopays.reduce((s, o) => s + o.amountPaise, 0);
  const fixedTotal = d.fixed.reduce((s, f) => s + Math.max(f.amountPaise, f.paidPaise), 0);
  const dayToDay = d.cycle.budgetPaise - fixedTotal - autopayTotal;

  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Fixed costs</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
      {d.fixed.length === 0 && autopays.length === 0 && <p className="text-xs text-muted-foreground">Add rent and other fixed monthly costs: they're set aside before your daily limit.</p>}
      {d.fixed.map((f) => (
        <Row key={f.name} name={f.name} sub={category(f.categoryId)?.name} amount={Math.max(f.amountPaise, f.paidPaise)} paid={f.paidPaise >= f.amountPaise} />
      ))}
      {autopays.map((o) => (
        <Row key={`${o.autopayId}-${o.dueOn}`} name={o.name} sub="autopay" amount={o.amountPaise} paid={o.status === "paid"} />
      ))}
      {d.cycle.budgetPaise > 0 && (d.fixed.length > 0 || autopays.length > 0) && (
        <p className="border-t pt-2 text-xs text-muted-foreground">
          {formatPaise(d.cycle.budgetPaise)} budget − {formatPaise(fixedTotal + autopayTotal)} fixed = <b className="text-foreground">{formatPaise(dayToDay)}</b> for day-to-day
          spending (food, electricity, petrol…).
        </p>
      )}
      <ResponsiveSheet open={editing} onOpenChange={setEditing} title="Fixed costs" description="Set aside from the budget every cycle. Payments filed under the category count, from any account.">
        {editing && <FixedCostsForm onDone={() => setEditing(false)} />}
      </ResponsiveSheet>
    </div>
  );
}

function Row({ name, sub, amount, paid }: { name: string; sub?: string; amount: number; paid: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        {name}
        {sub && <span className="text-muted-foreground"> · {sub}</span>}
      </span>
      {paid && (
        <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="size-3" /> paid
        </span>
      )}
      <span className="w-24 text-right tabular-nums">{formatPaise(amount)}</span>
    </div>
  );
}

function FixedCostsForm({ onDone }: { onDone: () => void }) {
  const { settings, activeCategories } = useLookups();
  const spendCategories = activeCategories.filter((c) => c.name !== "Salary" && c.name !== "Other income");
  const [rows, setRows] = useState(() =>
    (settings?.fixed_costs ?? []).map((f) => ({ name: f.name, categoryId: f.categoryId as number | "", amount: paiseToInput(f.amountPaise) })),
  );
  const valid = rows.every((r) => r.name.trim() && r.categoryId && rupeesToPaise(r.amount));
  const save = useLedgerMutation(
    () => patch("/settings", { fixed_costs: rows.map((r) => ({ name: r.name.trim(), categoryId: r.categoryId, amountPaise: rupeesToPaise(r.amount) })) }),
    "Fixed costs saved",
  );
  const update = (i: number, p: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="space-y-3 pb-2">
      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="flex gap-2">
            <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Rent" className="h-11 flex-1 md:h-9" aria-label="Name" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 className="text-destructive" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect value={r.categoryId} onChange={(e) => update(i, { categoryId: e.target.value ? Number(e.target.value) : "" })} aria-label="Category">
              <option value="">Category</option>
              {spendCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </NativeSelect>
            <RupeeInput value={r.amount} onChange={(v) => update(i, { amount: v })} placeholder="Per month" aria-label="Amount per month" />
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="w-full" onClick={() => setRows((rs) => [...rs, { name: "", categoryId: "", amount: "" }])}>
        <Plus /> Fixed cost
      </Button>
      <p className="text-xs text-muted-foreground">Bills with a bank autopay (like scooty rent) stay under Autopays. Bills that change every month (electricity) belong in day-to-day spending.</p>
      <Button className="h-11 w-full md:h-9" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
        Save
      </Button>
    </div>
  );
}
