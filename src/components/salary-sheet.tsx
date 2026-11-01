import { useState, type FormEvent } from "react";
import type { Dashboard } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { formatShortDate, istDate, istToUtc, parseDate } from "@shared/time";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { post } from "@/lib/api";
import { haptic } from "@/lib/haptic";
import { paiseToInput } from "@/lib/format";
import { useDashboard, useLedgerMutation, useLookups } from "@/lib/queries";

/**
 * Record salary by hand: amount, bank, day. It starts the new cycle from that day. If the bank's SMS for
 * the same credit is read later, it attaches to this entry instead of counting the salary twice.
 */
export function SalarySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: d } = useDashboard();
  const { settings } = useLookups();
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Salary received" description="Starts the new cycle from this day.">
      {/* Wait for last month's salary (the prefill): a push notification can open this on a cold start. */}
      {open && (d && settings ? <SalaryForm d={d} onDone={() => onOpenChange(false)} /> : <Skeleton className="h-40" />)}
    </ResponsiveSheet>
  );
}

function SalaryForm({ d, onDone }: { d: Dashboard; onDone: () => void }) {
  const { activeAccounts, categories, settings } = useLookups();
  const banks = activeAccounts.filter((a) => a.kind !== "credit_card");
  const today = istDate();
  const [amount, setAmount] = useState(() => paiseToInput(d.salary.lastPaise));
  const [accountId, setAccountId] = useState<number | undefined>(
    () => (banks.find((a) => a.id === d.salary.lastAccountId) ?? banks.find((a) => a.role === "salary") ?? banks[0])?.id,
  );
  const [date, setDate] = useState(today);
  const amountPaise = rupeesToPaise(amount);
  const salaryCategory = categories.find((c) => c.name === "Salary");

  const save = useLedgerMutation(
    () => {
      const { y, m, d: day } = parseDate(date);
      return post("/transactions", {
        accountId,
        amountPaise,
        direction: "credit",
        kind: "income",
        incomeSource: "salary",
        categoryId: salaryCategory?.id ?? null,
        merchant: settings?.salary_employer.trim() || null,
        // Today: now. An earlier day: mid-morning IST, when salaries usually land.
        occurredAt: (date === today ? new Date() : istToUtc(y, m, day, 10, 0)).toISOString(),
      });
    },
    () => `Salary of ${formatPaise(amountPaise ?? 0)} recorded · new cycle from ${formatShortDate(date)}`,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!amountPaise || !accountId || !date) return;
    save.mutate(undefined, {
      onSuccess: () => {
        haptic();
        onDone();
      },
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="sal-amount">Amount</Label>
        <RupeeInput id="sal-amount" value={amount} onChange={setAmount} autoFocus placeholder="0" className="text-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sal-account">Into</Label>
          <NativeSelect id="sal-account" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {banks.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sal-date">On</Label>
          <Input id="sal-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="h-11 md:h-9" />
        </div>
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={!amountPaise || !accountId || !date || save.isPending}>
        Record salary
      </Button>
    </form>
  );
}
