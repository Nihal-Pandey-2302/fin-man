import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarCheck, Check, HandCoins, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import type { Autopay, Loan } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { formatShortDate, istDate } from "@shared/time";
import { Money } from "@/components/money";
import { SalaryPlanCard } from "@/components/salary-plan-card";
import { SalarySheet } from "@/components/salary-sheet";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { paiseToInput } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { del, patch, post, put } from "@/lib/api";
import { invalidateLedger, keys, useAutopayCalendar, useAutopays, useCycles, useDashboard, useLoans, useLookups, useSalaryPlan } from "@/lib/queries";

export default function PlanPage() {
  const { data: plan } = useSalaryPlan();
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Plan</h1>
        <Button variant="outline" size="sm" asChild>
          <Link to="/plan/report">
            <BarChart3 /> Report
          </Link>
        </Button>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CycleCard />
        {plan && <SalaryPlanCard plan={plan} />}
        <AutopaysCard />
        <LoansCard />
      </div>
    </div>
  );
}

// ---------------- cycle budget ----------------
function CycleCard() {
  const { data: d } = useDashboard();
  const { data: cycles } = useCycles();
  const { activeCategories } = useLookups();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const current = cycles?.find((c) => c.id === d?.cycle.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>This cycle</CardTitle>
        <CardDescription>A cycle runs from one salary to the next. Spending excludes transfers, card bill payments and investments.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!d ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Budget" value={d.cycle.budgetPaise ? formatPaise(d.cycle.budgetPaise) : "—"} />
            <Stat label="Spent" value={formatPaise(d.cycle.spentPaise)} />
            <Stat label="Ends" value={formatShortDate(d.cycle.endDate)} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen(true)}>{d?.cycle.id ? "Edit budget" : "Set budget"}</Button>
          <Button variant="outline" onClick={() => setSalaryOpen(true)}>
            Salary received
          </Button>
          {d?.cycle.id && (
            <Button variant="outline" onClick={() => setLimitsOpen(true)}>
              Category limits{current?.budgets.length ? ` (${current.budgets.length})` : ""}
            </Button>
          )}
        </div>
      </CardContent>

      <SalarySheet open={salaryOpen} onOpenChange={setSalaryOpen} />
      <ResponsiveSheet open={open} onOpenChange={setOpen} title="Cycle budget" description="How much you plan to spend this cycle, including bills and EMIs (not SIPs).">
        {open && d && (
          <CycleForm
            startDate={d.cycle.id ? d.cycle.startDate : istDate()}
            budget={d.cycle.budgetPaise}
            onDone={() => {
              setOpen(false);
              void qc.invalidateQueries({ queryKey: keys.cycles });
              invalidateLedger(qc);
            }}
          />
        )}
      </ResponsiveSheet>

      <ResponsiveSheet open={limitsOpen} onOpenChange={setLimitsOpen} title="Category limits" description="Optional caps; shown on the dashboard.">
        {limitsOpen && current && (
          <LimitsForm
            cycleId={current.id}
            categories={activeCategories.filter((c) => c.name !== "Salary" && c.name !== "Other income")}
            initial={current.budgets}
            onDone={() => {
              setLimitsOpen(false);
              void qc.invalidateQueries({ queryKey: keys.cycles });
              invalidateLedger(qc);
            }}
          />
        )}
      </ResponsiveSheet>
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

function CycleForm({ startDate, budget, onDone }: { startDate: string; budget: number; onDone: () => void }) {
  const [start, setStart] = useState(startDate);
  const [amount, setAmount] = useState(paiseToInput(budget));
  const paise = rupeesToPaise(amount);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (paise === null) return;
    await post("/cycles", { startDate: start, plannedSpendPaise: paise });
    toast.success("Budget saved");
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-start">Cycle starts</Label>
          <Input id="c-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-budget">Planned spend</Label>
          <RupeeInput id="c-budget" value={amount} onChange={setAmount} autoFocus />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Starting a new cycle closes the previous one the day before. Salary detection will do this automatically.</p>
      <Button type="submit" className="w-full" disabled={paise === null}>
        Save
      </Button>
    </form>
  );
}

function LimitsForm({
  cycleId,
  categories,
  initial,
  onDone,
}: {
  cycleId: number;
  categories: { id: number; name: string; emoji: string | null }[];
  initial: { categoryId: number; limitPaise: number }[];
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(initial.map((b) => [b.categoryId, paiseToInput(b.limitPaise)])));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const budgets = Object.entries(values)
      .map(([id, v]) => ({ categoryId: Number(id), limitPaise: rupeesToPaise(v) ?? 0 }))
      .filter((b) => b.limitPaise > 0);
    await put(`/cycles/${cycleId}/budgets`, { budgets });
    toast.success("Limits saved");
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-2 pb-2">
      {categories.map((c) => (
        <div key={c.id} className="flex items-center gap-3">
          <span className="flex-1 text-sm">
            {c.emoji} {c.name}
          </span>
          <div className="w-36">
            <RupeeInput aria-label={`${c.name} limit`} value={values[c.id] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [c.id]: v }))} placeholder="No limit" />
          </div>
        </div>
      ))}
      <Button type="submit" className="sticky bottom-0 mt-2 w-full">
        Save limits
      </Button>
    </form>
  );
}

// ---------------- autopays ----------------
const FREQ_SHORT = { monthly: "monthly", quarterly: "quarterly", yearly: "yearly" } as const;
const AUTOPAY_KIND_LABEL = { sip: "SIP", bill: "Bill", emi: "EMI", subscription: "Subscription", insurance: "Insurance" } as const;

function AutopaysCard() {
  const { data, isPending } = useAutopays();
  const { account } = useLookups();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Autopay | "new" | null>(null);
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.autopays });
    invalidateLedger(qc);
  };
  const today = istDate();
  const active = data?.filter((a) => a.active) ?? [];
  const monthly = active.reduce((s, a) => s + (a.frequency === "monthly" ? a.amountPaise : a.frequency === "quarterly" ? a.amountPaise / 3 : a.amountPaise / 12), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Autopays</CardTitle>
          <CardDescription>SIPs, bills, EMIs and subscriptions{monthly ? ` · about ${formatPaise(Math.round(monthly))}/month` : ""}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {!!data?.length && (
          <div className="mb-2 grid w-fit grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
            {(["calendar", "list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cn("h-8 rounded-md px-3", view === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                {v === "calendar" ? "This cycle" : "All"}
              </button>
            ))}
          </div>
        )}
        {isPending && <Skeleton className="h-24" />}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">Add the debits that hit your autopay account so they're kept out of safe-to-spend.</p>}
        {view === "calendar" && !!data?.length && <AutopayCalendar onOpen={(id) => setEditing(data.find((a) => a.id === id) ?? null)} />}
        {view === "list" && !!data?.length && (
          <div className="-mx-2">
            {data.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setEditing(a)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted/60", !a.active && "opacity-50")}
              >
                <span className="w-14 shrink-0 text-center">
                  <span className="block text-lg leading-none font-semibold tabular-nums">{a.dayOfMonth}</span>
                  <span className="text-[10px] text-muted-foreground">{FREQ_SHORT[a.frequency]}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {AUTOPAY_KIND_LABEL[a.kind]} · {account(a.accountId)?.name} · next {formatShortDate(a.nextDueOn)}
                    {a.nextDueOn < today && a.active && " (overdue?)"}
                  </span>
                </span>
                <Money paise={a.amountPaise} className="font-medium" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
      <ResponsiveSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "New autopay" : "Edit autopay"}>
        {editing !== null && (
          <AutopayForm
            initial={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}
      </ResponsiveSheet>
    </Card>
  );
}

function AutopayForm({ initial, onDone }: { initial: Autopay | null; onDone: () => void }) {
  const { activeAccounts, activeCategories } = useLookups();
  const autopayAccount = activeAccounts.find((a) => a.role === "autopay") ?? activeAccounts[0];
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<Autopay["kind"]>(initial?.kind ?? "bill");
  const [accountId, setAccountId] = useState(initial?.accountId ?? autopayAccount?.id);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [amount, setAmount] = useState(paiseToInput(initial?.amountPaise));
  const [frequency, setFrequency] = useState<Autopay["frequency"]>(initial?.frequency ?? "monthly");
  const [day, setDay] = useState(String(initial?.dayOfMonth ?? ""));
  const [nextDueOn, setNextDueOn] = useState(initial?.nextDueOn ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [matchHint, setMatchHint] = useState(initial?.matchHint ?? "");
  const paise = rupeesToPaise(amount);
  const dayNum = Number(day);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: name.trim(),
      kind,
      accountId,
      categoryId,
      amountPaise: paise,
      frequency,
      dayOfMonth: dayNum,
      active,
      matchHint: matchHint.trim() || null,
      ...(nextDueOn && { nextDueOn }),
    };
    if (initial) await patch(`/autopays/${initial.id}`, body);
    else await post("/autopays", body);
    toast.success("Saved");
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="a-name">Name</Label>
        <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car EMI, Netflix, Parag Parikh SIP" className="h-11 md:h-9" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="a-kind">Type</Label>
          <NativeSelect id="a-kind" value={kind} onChange={(e) => setKind(e.target.value as Autopay["kind"])}>
            {Object.entries(AUTOPAY_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-amount">Amount</Label>
          <RupeeInput id="a-amount" value={amount} onChange={setAmount} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-freq">Repeats</Label>
          <NativeSelect id="a-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Autopay["frequency"])}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-day">Day of month</Label>
          <Input id="a-day" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-account">From account</Label>
          <NativeSelect id="a-account" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-next">Next due {!initial && <span className="font-normal text-muted-foreground">(auto)</span>}</Label>
          <Input id="a-next" type="date" value={nextDueOn} onChange={(e) => setNextDueOn(e.target.value)} className="h-11 md:h-9" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-cat">Category</Label>
        <NativeSelect id="a-cat" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">—</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-hint">Text in the debit SMS (optional)</Label>
        <Input id="a-hint" value={matchHint} onChange={(e) => setMatchHint(e.target.value)} placeholder="e.g. biller name, used to mark it paid" className="h-11 md:h-9" />
      </div>
      <label className="flex items-center justify-between text-sm">
        Active <Switch checked={active} onCheckedChange={setActive} />
      </label>
      <div className="flex gap-2">
        {initial && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive"
              aria-label="Delete"
              onClick={async () => {
                await del(`/autopays/${initial.id}`);
                onDone();
              }}
            >
              <Trash2 />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await post(`/autopays/${initial.id}/paid`);
                toast.success("Marked paid · next due moved forward");
                onDone();
              }}
            >
              <CalendarCheck /> Mark paid
            </Button>
          </>
        )}
        <Button type="submit" className="ml-auto" disabled={!name.trim() || !paise || !accountId || !(dayNum >= 1 && dayNum <= 31)}>
          Save
        </Button>
      </div>
    </form>
  );
}

const STATUS_STYLE = {
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  due: "bg-muted text-muted-foreground",
  overdue: "bg-destructive/15 text-destructive",
} as const;

function AutopayCalendar({ onOpen }: { onOpen: (autopayId: number) => void }) {
  const { data, isPending } = useAutopayCalendar();
  const { account } = useLookups();
  if (isPending) return <Skeleton className="h-24" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Nothing scheduled this cycle.</p>;
  const left = data.filter((o) => o.status !== "paid").reduce((s, o) => s + o.amountPaise, 0);
  return (
    <div className="-mx-2 space-y-1">
      {data.map((o) => (
        <button key={`${o.autopayId}-${o.dueOn}`} type="button" onClick={() => onOpen(o.autopayId)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60">
          <span className="w-14 shrink-0 text-sm text-muted-foreground tabular-nums">{formatShortDate(o.dueOn)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{o.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{account(o.accountId)?.name}</span>
          </span>
          {o.status !== "due" && (
            <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[o.status])}>
              {o.status === "paid" && <Check className="size-3" />}
              {o.status}
            </span>
          )}
          <Money paise={o.amountPaise} className="w-20 text-right font-medium" />
        </button>
      ))}
      <p className="px-2 pt-1 text-right text-xs text-muted-foreground">{formatPaise(left)} still to go this cycle</p>
    </div>
  );
}

// ---------------- loans / IOUs ----------------
function LoansCard() {
  const { data, isPending } = useLoans();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Loan | "new" | null>(null);
  const [paying, setPaying] = useState<Loan | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.loans });
  const open = data?.filter((l) => l.status !== "settled") ?? [];
  const owedToMe = open.filter((l) => l.direction === "they_owe").reduce((s, l) => s + l.principalPaise - l.paidPaise, 0);
  const iOwe = open.filter((l) => l.direction === "you_owe").reduce((s, l) => s + l.principalPaise - l.paidPaise, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Loans & IOUs</CardTitle>
          <CardDescription>
            Owed to you {formatPaise(owedToMe)} · you owe {formatPaise(iOwe)}
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {isPending && <Skeleton className="h-20" />}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">Track money you lent or borrowed, with partial repayments.</p>}
        {data?.map((l) => {
          const left = l.principalPaise - l.paidPaise;
          return (
            <div key={l.id} className={cn("space-y-2 rounded-lg border p-3", l.status === "settled" && "opacity-60")}>
              <button type="button" onClick={() => setEditing(l)} className="flex w-full items-start gap-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.person}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.direction === "they_owe" ? "Owes you" : "You owe"} · since {formatShortDate(l.openedOn)}
                    {l.dueOn && ` · due ${formatShortDate(l.dueOn)}`}
                    {l.reason && ` · ${l.reason}`}
                  </span>
                </span>
                {l.status === "settled" ? <Badge variant="secondary">Settled</Badge> : <Money paise={left} className="font-semibold" />}
              </button>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (l.paidPaise / l.principalPaise) * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {formatPaise(l.paidPaise)} of {formatPaise(l.principalPaise)} repaid
                </span>
                {l.status !== "settled" && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => setPaying(l)}>
                    <HandCoins /> Record payment
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
      <ResponsiveSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "New loan / IOU" : "Edit loan"}>
        {editing !== null && (
          <LoanForm
            initial={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}
      </ResponsiveSheet>
      <ResponsiveSheet open={paying !== null} onOpenChange={(o) => !o && setPaying(null)} title="Record repayment" description={paying?.person}>
        {paying && (
          <PaymentForm
            loan={paying}
            onDone={() => {
              setPaying(null);
              refresh();
            }}
          />
        )}
      </ResponsiveSheet>
    </Card>
  );
}

function LoanForm({ initial, onDone }: { initial: Loan | null; onDone: () => void }) {
  const [person, setPerson] = useState(initial?.person ?? "");
  const [direction, setDirection] = useState<Loan["direction"]>(initial?.direction ?? "they_owe");
  const [amount, setAmount] = useState(paiseToInput(initial?.principalPaise));
  const [openedOn, setOpenedOn] = useState(initial?.openedOn ?? istDate());
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const paise = rupeesToPaise(amount);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { person: person.trim(), direction, principalPaise: paise, openedOn, dueOn: dueOn || null, reason: reason.trim() || null };
    if (initial) await patch(`/loans/${initial.id}`, body);
    else await post("/loans", body);
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        {(["they_owe", "you_owe"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`h-9 rounded-md text-sm font-medium ${direction === d ? "bg-card shadow-sm" : "text-muted-foreground"}`}
          >
            {d === "they_owe" ? "I lent" : "I borrowed"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="l-person">Person</Label>
          <Input id="l-person" value={person} onChange={(e) => setPerson(e.target.value)} className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l-amount">Amount</Label>
          <RupeeInput id="l-amount" value={amount} onChange={setAmount} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l-opened">Date</Label>
          <Input id="l-opened" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l-due">Due (optional)</Label>
          <Input id="l-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-11 md:h-9" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="l-reason">Reason</Label>
        <Input id="l-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 md:h-9" />
      </div>
      <div className="flex gap-2">
        {initial && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive"
            aria-label="Delete"
            onClick={async () => {
              await del(`/loans/${initial.id}`);
              onDone();
            }}
          >
            <Trash2 />
          </Button>
        )}
        <Button type="submit" className="ml-auto" disabled={!person.trim() || !paise}>
          Save
        </Button>
      </div>
    </form>
  );
}

function PaymentForm({ loan, onDone }: { loan: Loan; onDone: () => void }) {
  const [amount, setAmount] = useState(paiseToInput(loan.principalPaise - loan.paidPaise));
  const [paidOn, setPaidOn] = useState(istDate());
  const paise = rupeesToPaise(amount);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await post(`/loans/${loan.id}/payments`, { amountPaise: paise, paidOn });
    toast.success("Repayment recorded");
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="p-amount">Amount</Label>
          <RupeeInput id="p-amount" value={amount} onChange={setAmount} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-date">Date</Label>
          <Input id="p-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="h-11 md:h-9" />
        </div>
      </div>
      {loan.payments.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {loan.payments.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{formatShortDate(p.paidOn)}</span>
              <span className="tabular-nums">{formatPaise(p.amountPaise)}</span>
            </li>
          ))}
        </ul>
      )}
      <Button type="submit" className="w-full" disabled={!paise}>
        Save
      </Button>
    </form>
  );
}
