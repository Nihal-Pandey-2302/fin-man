import { CheckCircle2, CreditCard } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "cn";
import type { CardStatus } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { post, put } from "@/lib/api";
import { paiseToInput } from "@/lib/format";
import { useLedgerMutation, useLookups } from "@/lib/queries";

const utilTone = (u: number) => (u < 0.3 ? "bg-emerald-500" : u < 0.5 ? "bg-amber-500" : "bg-destructive");
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? `${-n} ${n === -1 ? "day" : "days"} late` : `${n} days left`);

/**
 * A credit card on Home: what the last statement asks for and by when (paying it in full avoids interest),
 * how much is already paid, utilization, and what's building up for the next bill.
 */
export function CardBill({ status: s }: { status: CardStatus }) {
  const { account } = useLookups();
  const card = account(s.accountId);
  const [editing, setEditing] = useState(false);
  if (!card) return null;
  const nextStatement = card.balance.nextStatementOn;

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CreditCard className="size-4" />
          <span className="flex-1 truncate">{card.name}</span>
          {s.statementDate && s.status !== "unknown" && (
            <button type="button" onClick={() => setEditing(true)} className="text-xs underline-offset-2 hover:underline">
              Edit statement
            </button>
          )}
        </div>

        <BillState s={s} onEnter={() => setEditing(true)} />
        {(s.status === "due" || s.status === "overdue") && s.leftToPayPaise ? <MarkPaid s={s} /> : null}

        {s.limitPaise != null && s.utilization != null && (
          <div className="space-y-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(s.utilization * 100)}% of the limit used`}>
              <div className={cn("h-full rounded-full transition-all", utilTone(s.utilization))} style={{ width: `${Math.min(100, s.utilization * 100)}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {Math.round(s.utilization * 100)}% used · {formatPaise(Math.max(0, s.outstandingPaise))} owed
              </span>
              <span>Available {formatPaise(s.limitPaise - Math.max(0, s.outstandingPaise))}</span>
            </div>
          </div>
        )}

        {s.statementDate && s.spentSincePaise > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatPaise(s.spentSincePaise)} spent since {formatShortDate(s.statementDate)}
            {nextStatement && ` · goes on the ${formatShortDate(nextStatement)} bill`}
          </p>
        )}
      </CardContent>
      <ResponsiveSheet
        open={editing}
        onOpenChange={setEditing}
        title={s.statementDate ? `Statement of ${formatShortDate(s.statementDate)}` : "Statement"}
        description="The total due on your card statement (from the card app, email or SMS)."
      >
        {editing && s.statementDate && <StatementForm s={s} onDone={() => setEditing(false)} />}
      </ResponsiveSheet>
    </Card>
  );
}

function BillState({ s, onEnter }: { s: CardStatus; onEnter: () => void }) {
  if (!s.statementDate) {
    return (
      <div>
        <p className="text-2xl font-semibold tabular-nums">{formatPaise(Math.max(0, s.outstandingPaise))}</p>
        <p className="text-xs text-muted-foreground">owed · set the statement and due day in Accounts to track bills</p>
      </div>
    );
  }
  if (s.status === "unknown") {
    return (
      <div className="space-y-2">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{formatPaise(Math.max(0, s.outstandingPaise))}</p>
          <p className="text-xs text-muted-foreground">
            owed in total{s.dueDate && ` · bill due ${formatShortDate(s.dueDate)}`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onEnter}>
          Enter the {formatShortDate(s.statementDate)} statement amount
        </Button>
      </div>
    );
  }
  if (s.status === "paid" || s.status === "nothing_due") {
    return (
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-6 shrink-0 text-emerald-500" />
        <div>
          <p className="font-semibold">{s.status === "paid" ? "Statement paid in full" : "Nothing due"}</p>
          <p className="text-xs text-muted-foreground">
            {formatShortDate(s.statementDate)} statement{s.statementPaise ? ` · ${formatPaise(s.statementPaise)}` : ""}
          </p>
        </div>
      </div>
    );
  }
  const urgent = s.status === "overdue" || (s.daysToDue !== null && s.daysToDue <= 3);
  const paidShare = s.statementPaise ? Math.min(1, s.paidPaise / s.statementPaise) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold tabular-nums">Pay {formatPaise(s.leftToPayPaise ?? 0)}</p>
        {s.dueDate && s.daysToDue !== null && (
          <span className={cn("text-sm", urgent ? (s.status === "overdue" ? "font-medium text-destructive" : "font-medium text-amber-600 dark:text-amber-400") : "text-muted-foreground")}>
            by {formatShortDate(s.dueDate)} · {inDays(s.daysToDue)}
          </span>
        )}
      </div>
      {s.paidPaise > 0 && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidShare * 100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Paid {formatPaise(s.paidPaise)} of {formatPaise(s.statementPaise ?? 0)}
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {formatShortDate(s.statementDate)} statement{s.statementSource === "computed" ? " (worked out from your card SMS)" : ""}. Pay it in full to avoid interest
        {s.minDuePaise ? `; the minimum ${formatPaise(s.minDuePaise)} only avoids the late fee` : ""}.
      </p>
    </div>
  );
}

/**
 * One tap after paying the bill: records the payment from the salary account. If the bank's debit SMS has
 * already arrived, that transaction is reused (POST /transfers), so nothing is counted twice.
 */
function MarkPaid({ s }: { s: CardStatus }) {
  const { activeAccounts } = useLookups();
  const from = activeAccounts.find((a) => a.role === "salary") ?? activeAccounts.find((a) => a.kind === "bank");
  const pay = useLedgerMutation(
    () => post("/transfers", { fromAccountId: from!.id, toAccountId: s.accountId, amountPaise: s.leftToPayPaise, note: "Card bill" }),
    `Recorded ${formatPaise(s.leftToPayPaise ?? 0)} paid`,
  );
  if (!from) return null;
  return (
    <Button size="sm" variant="outline" disabled={pay.isPending} onClick={() => pay.mutate(undefined)}>
      I've paid it from {from.name}
    </Button>
  );
}

function StatementForm({ s, onDone }: { s: CardStatus; onDone: () => void }) {
  const [amount, setAmount] = useState(() => paiseToInput(s.statementSource === "bank" ? s.statementPaise : null));
  const [minDue, setMinDue] = useState(() => paiseToInput(s.minDuePaise));
  const amountPaise = rupeesToPaise(amount);
  const save = useLedgerMutation(
    () => put(`/cards/${s.accountId}/statement`, { statementDate: s.statementDate, amountPaise: amountPaise ?? 0, minDuePaise: rupeesToPaise(minDue) }),
    "Statement saved",
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (amountPaise === null) return;
    save.mutate(undefined, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="st-amount">Total amount due</Label>
        <RupeeInput id="st-amount" value={amount} onChange={setAmount} autoFocus placeholder="0" className="text-lg" />
        {s.statementSource === "computed" && s.statementPaise !== null && (
          <p className="text-xs text-muted-foreground">Worked out from your SMS: {formatPaise(s.statementPaise)}. Enter the bank's figure if it differs.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="st-min">
          Minimum due <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <RupeeInput id="st-min" value={minDue} onChange={setMinDue} placeholder="0" />
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={amountPaise === null || save.isPending}>
        Save
      </Button>
    </form>
  );
}
