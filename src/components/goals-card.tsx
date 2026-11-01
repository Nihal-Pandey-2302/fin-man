import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Goal } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { del, patch, post } from "@/lib/api";
import { paiseToInput } from "@/lib/format";
import { useGoals, useLedgerMutation, useLookups } from "@/lib/queries";

type Sheet = { kind: "target" } | { kind: "goal"; goal: Goal | null } | { kind: "set-aside"; goal: Goal } | null;

/** Plan: the savings target ("pay yourself first") and goals for irregular costs. */
export function GoalsCard() {
  const { data: goals, isPending } = useGoals();
  const { settings, account } = useLookups();
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);
  const active = goals?.filter((g) => !g.archived) ?? [];
  const target = settings?.savings_target_paise ?? 0;
  const savingsAccount = account(settings?.savings_account_id);

  return (
    <Card id="savings" className="scroll-mt-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Savings & goals</CardTitle>
          <CardDescription>Pay yourself first: set the savings aside on salary day, before spending.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setSheet({ kind: "goal", goal: null })}>
          <Plus /> Goal
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <button type="button" onClick={() => setSheet({ kind: "target" })} className="flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left hover:bg-muted">
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">Savings target per cycle</span>
            <span className="block font-semibold tabular-nums">{target ? formatPaise(target) : "Not set"}</span>
          </span>
          <span className="text-right text-xs text-muted-foreground">{savingsAccount ? `moved to ${savingsAccount.name}` : "kept in your salary account"}</span>
        </button>

        {isPending && <Skeleton className="h-16" />}
        {!isPending && active.length === 0 && (
          <p className="text-sm text-muted-foreground">Add goals for costs that don't come every month (insurance, a trip, a new phone). Each shows what to set aside monthly.</p>
        )}
        {active.map((g) => (
          <div key={g.id} className="space-y-2 rounded-lg border p-3">
            <button type="button" onClick={() => setSheet({ kind: "goal", goal: g })} className="flex w-full items-baseline justify-between gap-2 text-left">
              <span className="truncate font-medium">{g.name}</span>
              <span className="shrink-0 text-sm tabular-nums">
                {formatPaise(g.savedPaise)} <span className="text-muted-foreground">/ {formatPaise(g.targetPaise)}</span>
              </span>
            </button>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (g.savedPaise / g.targetPaise) * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {g.savedPaise >= g.targetPaise
                  ? "Reached"
                  : g.monthlyNeedPaise
                    ? `${formatPaise(g.monthlyNeedPaise)}/month${g.dueOn ? ` · by ${formatShortDate(g.dueOn)}` : ""}`
                    : g.dueOn
                      ? `by ${formatShortDate(g.dueOn)}`
                      : "No deadline"}
              </span>
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setSheet({ kind: "set-aside", goal: g })}>
                Set aside
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <ResponsiveSheet open={sheet?.kind === "target"} onOpenChange={(o) => !o && close()} title="Savings target" description="What you want to save each cycle.">
        {sheet?.kind === "target" && <TargetForm onDone={close} />}
      </ResponsiveSheet>
      <ResponsiveSheet open={sheet?.kind === "goal"} onOpenChange={(o) => !o && close()} title={sheet?.kind === "goal" && sheet.goal ? "Edit goal" : "New goal"}>
        {sheet?.kind === "goal" && <GoalForm goal={sheet.goal} onDone={close} />}
      </ResponsiveSheet>
      <ResponsiveSheet
        open={sheet?.kind === "set-aside"}
        onOpenChange={(o) => !o && close()}
        title={sheet?.kind === "set-aside" ? sheet.goal.name : ""}
        description="Money set aside stays in your bank, earmarked for this goal."
      >
        {sheet?.kind === "set-aside" && <SetAsideForm goal={sheet.goal} onDone={close} />}
      </ResponsiveSheet>
    </Card>
  );
}

function TargetForm({ onDone }: { onDone: () => void }) {
  const { settings, activeAccounts } = useLookups();
  const [amount, setAmount] = useState(() => paiseToInput(settings?.savings_target_paise));
  const [accountId, setAccountId] = useState<number | "">(settings?.savings_account_id ?? "");
  const banks = activeAccounts.filter((a) => a.kind !== "credit_card" && a.role !== "salary");
  const save = useLedgerMutation(
    () => patch("/settings", { savings_target_paise: rupeesToPaise(amount) ?? 0, savings_account_id: accountId === "" ? null : accountId }),
    "Savings target saved",
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="sv-amount">Save per cycle</Label>
        <RupeeInput id="sv-amount" value={amount} onChange={setAmount} autoFocus placeholder="0" className="text-lg" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sv-account">Where it goes</Label>
        <NativeSelect id="sv-account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Stays in the salary account</option>
          {banks.map((a) => (
            <option key={a.id} value={a.id}>
              Moved to {a.name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">With a savings account, the salary-day plan gets a "Savings" step that ticks off when the transfer arrives.</p>
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={save.isPending}>
        Save
      </Button>
    </form>
  );
}

function GoalForm({ goal, onDone }: { goal: Goal | null; onDone: () => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(() => paiseToInput(goal?.targetPaise));
  const [dueOn, setDueOn] = useState(goal?.dueOn ?? "");
  const [monthly, setMonthly] = useState(() => paiseToInput(goal?.monthlyPaise));
  const targetPaise = rupeesToPaise(target);
  const body = () => ({ name: name.trim(), targetPaise, dueOn: dueOn || null, monthlyPaise: rupeesToPaise(monthly) || null });
  const save = useLedgerMutation(() => (goal ? patch(`/goals/${goal.id}`, body()) : post("/goals", body())), goal ? "Goal saved" : "Goal added");
  const remove = useLedgerMutation(() => del(`/goals/${goal!.id}`), "Goal deleted");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetPaise) return;
    save.mutate(undefined, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="gl-name">Name</Label>
        <Input id="gl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car insurance, Goa trip" className="h-11 md:h-9" autoFocus={!goal} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="gl-target">Target</Label>
          <RupeeInput id="gl-target" value={target} onChange={setTarget} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gl-due">
            By <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="gl-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-11 md:h-9" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="gl-monthly">
          Fixed monthly amount <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <RupeeInput id="gl-monthly" value={monthly} onChange={setMonthly} placeholder="Otherwise: what's left ÷ months to go" />
      </div>
      <div className="flex items-center gap-2">
        {goal && (
          <Button type="button" variant="ghost" size="icon" aria-label="Delete goal" onClick={() => remove.mutate(undefined, { onSuccess: onDone })}>
            <Trash2 className="text-destructive" />
          </Button>
        )}
        <Button type="submit" className="ml-auto h-11 md:h-9" disabled={!name.trim() || !targetPaise || save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

function SetAsideForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [amount, setAmount] = useState(() => paiseToInput(goal.monthlyNeedPaise || null));
  const paise = rupeesToPaise(amount);
  const move = useLedgerMutation(
    (sign: 1 | -1) => post(`/goals/${goal.id}/set-aside`, { amountPaise: sign * (paise ?? 0) }),
    (r) => `${goal.name}: ${formatPaise((r as Goal).savedPaise)} set aside`,
  );
  const go = (sign: 1 | -1) => (e?: FormEvent) => {
    e?.preventDefault();
    if (!paise) return;
    move.mutate(sign, { onSuccess: onDone });
  };
  return (
    <form onSubmit={go(1)} className="space-y-4 pb-2">
      <p className="text-sm text-muted-foreground">
        {formatPaise(goal.savedPaise)} of {formatPaise(goal.targetPaise)} set aside.
      </p>
      <RupeeInput value={amount} onChange={setAmount} autoFocus placeholder="0" className="text-lg" aria-label="Amount" />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-11 md:h-9" disabled={!paise || goal.savedPaise === 0 || move.isPending} onClick={() => go(-1)()}>
          Take back / spent
        </Button>
        <Button type="submit" className="h-11 md:h-9" disabled={!paise || move.isPending}>
          Set aside
        </Button>
      </div>
    </form>
  );
}
