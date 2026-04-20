"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pushToast } from "@/lib/toast";

export type Loan = {
  id: string;
  person_name: string;
  amount: number;
  type: "you_owe" | "they_owe";
  reason: string | null;
  date: string;
  due_date: string | null;
  status: "open" | "partially_paid" | "settled";
  amount_paid: number;
  notes: string | null;
};

export type LoanPayment = {
  id: string;
  loan_id: string;
  amount: number;
  date: string;
  note: string | null;
};

const defaultForm = {
  person_name: "",
  amount: "0",
  type: "you_owe",
  reason: "",
  date: new Date().toISOString().slice(0, 10),
  due_date: "",
  notes: "",
};

export function LoansManager({
  initialLoans,
  initialPayments,
}: {
  initialLoans: Loan[];
  initialPayments: LoanPayment[];
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loans, setLoans] = useState<Loan[]>(initialLoans);
  const [payments, setPayments] = useState<LoanPayment[]>(initialPayments);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentModalLoan, setPaymentModalLoan] = useState<Loan | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const refresh = async () => {
    const [loansRes, paymentsRes] = await Promise.all([
      supabase
        .from("loans")
        .select("id, person_name, amount, type, reason, date, due_date, status, amount_paid, notes")
        .order("date", { ascending: false }),
      supabase
        .from("loan_payments")
        .select("id, loan_id, amount, date, note")
        .order("date", { ascending: false }),
    ]);
    if (loansRes.error) {
      setError(loansRes.error.message);
      return;
    }
    if (paymentsRes.error) {
      setError(paymentsRes.error.message);
      return;
    }
    setLoans((loansRes.data ?? []) as Loan[]);
    setPayments((paymentsRes.data ?? []) as LoanPayment[]);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("No active user session.");
      return;
    }
    const payload = {
      user_id: userId,
      person_name: form.person_name.trim(),
      amount: Number(form.amount),
      type: form.type,
      reason: form.reason.trim() || null,
      date: form.date,
      due_date: form.due_date || null,
      notes: form.notes.trim() || null,
      status: "open",
    };
    const query = editingId
      ? supabase.from("loans").update(payload).eq("id", editingId)
      : supabase.from("loans").insert(payload);
    const { error: upsertError } = await query;
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setForm(defaultForm);
    setEditingId(null);
    await refresh();
    pushToast({ message: editingId ? "Loan updated" : "Loan added", tone: "success" });
  };

  const addPayment = async (loan: Loan) => {
    const amount = Number(paymentAmount || "0");
    if (amount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }
    const nextPaid = Number(loan.amount_paid) + amount;
    const nextStatus =
      nextPaid >= Number(loan.amount) ? "settled" : nextPaid > 0 ? "partially_paid" : "open";

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("No active user session.");
      return;
    }

    const [insertRes, updateRes] = await Promise.all([
      supabase.from("loan_payments").insert({
        user_id: userId,
        loan_id: loan.id,
        amount,
        date: new Date().toISOString().slice(0, 10),
        note: paymentNote.trim() || null,
      }),
      supabase.from("loans").update({ amount_paid: nextPaid, status: nextStatus }).eq("id", loan.id),
    ]);
    if (insertRes.error) {
      setError(insertRes.error.message);
      return;
    }
    if (updateRes.error) {
      setError(updateRes.error.message);
      return;
    }
    setPaymentAmount("");
    setPaymentNote("");
    setPaymentModalLoan(null);
    await refresh();
    pushToast({ message: "Partial payment recorded", tone: "success" });
  };

  const markSettled = async (loan: Loan) => {
    const { error: updateError } = await supabase
      .from("loans")
      .update({ status: "settled", amount_paid: Number(loan.amount) })
      .eq("id", loan.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await refresh();
    pushToast({ message: "Loan marked as settled", tone: "success" });
  };

  const owes = loans.filter((loan) => loan.type === "you_owe");
  const owed = loans.filter((loan) => loan.type === "they_owe");
  const today = new Date().toISOString().slice(0, 10);
  const owesRemaining = owes
    .filter((loan) => loan.status !== "settled")
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) - Number(loan.amount_paid || 0)), 0);
  const owedRemaining = owed
    .filter((loan) => loan.status !== "settled")
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) - Number(loan.amount_paid || 0)), 0);
  const net = owedRemaining - owesRemaining;

  const renderLoanList = (list: Loan[]) =>
    list.map((loan) => {
      const overdue =
        !!loan.due_date && loan.due_date < today && loan.status !== "settled";
      const loanPayments = payments.filter((payment) => payment.loan_id === loan.id);
      const paid = Number(loan.amount_paid || 0);
      const total = Number(loan.amount || 0);
      const remaining = Math.max(0, total - paid);
      const progress = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
      const initial = (loan.person_name || "?").slice(0, 1).toUpperCase();
      const avatarTone = loan.type === "you_owe" ? "bg-red-500/20 text-red-300" : "bg-green-500/20 text-green-300";
      return (
        <article key={loan.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTone}`}>
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{loan.person_name}</p>
                <p className="truncate text-xs text-zinc-500">{loan.reason ?? "No reason"}</p>
                <p className="mt-1 font-mono text-xl text-zinc-100">
                  <span className="rupee-sign">₹</span> {total.toFixed(2)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                  loan.status === "settled"
                    ? "bg-green-500/20 text-green-300"
                    : loan.status === "partially_paid"
                      ? "bg-blue-500/20 text-blue-300"
                      : "bg-yellow-500/20 text-yellow-200"
                }`}
              >
                {loan.status.replace("_", " ")}
              </span>
              <p className="mt-1 text-xs text-zinc-400">
                Paid <span className="rupee-sign">₹</span> {paid.toFixed(2)} • Rem <span className="rupee-sign">₹</span> {remaining.toFixed(2)}
              </p>
              {loan.due_date ? (
                <p className={`text-xs ${overdue ? "text-red-400" : "text-zinc-400"}`}>
                  Due {loan.due_date} {overdue ? "(Overdue)" : ""}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPaymentModalLoan(loan);
                setPaymentAmount("");
                setPaymentNote("");
              }}
              className="rounded-md border border-blue-700 px-2 py-1 text-xs text-blue-300"
            >
              Record Payment
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingId(loan.id);
                setForm({
                  person_name: loan.person_name,
                  amount: String(loan.amount),
                  type: loan.type,
                  reason: loan.reason ?? "",
                  date: loan.date,
                  due_date: loan.due_date ?? "",
                  notes: loan.notes ?? "",
                });
              }}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs"
            >
              Edit
            </button>
            <button type="button" onClick={() => void markSettled(loan)} className="rounded-md border border-green-800 px-2 py-1 text-xs text-green-300">
              Mark Settled
            </button>
          </div>

          {loanPayments.length > 0 ? (
            <div className="mt-2 rounded-md border border-zinc-800 p-2">
              <p className="text-xs text-zinc-400">Payment history</p>
              <div className="mt-1 space-y-1">
                {loanPayments.map((payment) => (
                  <p key={payment.id} className="text-xs text-zinc-300">
                    {payment.date}: <span className="rupee-sign">₹</span> {Number(payment.amount).toFixed(2)} {payment.note ? `- ${payment.note}` : ""}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      );
    });

  return (
    <section className="space-y-4 pb-24">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="border-l-4 border-blue-500 pl-3 text-lg font-semibold">Loans</h1>
        <p className="mt-1 text-sm text-zinc-400">Track liabilities and receivables with partial payment logs.</p>
      </header>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-xs text-zinc-400">Net summary</p>
        <p className={`metric-value mt-1 ${net >= 0 ? "text-green-300" : "text-red-300"}`}>
          Net: {net >= 0 ? "you are owed" : "you owe"} <span className="rupee-sign">₹</span> {Math.abs(net).toFixed(2)} {net >= 0 ? "more than you owe" : "more than you are owed"}
        </p>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <form onSubmit={onSubmit} className="grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 md:grid-cols-4">
        <input required placeholder="Person name" value={form.person_name} onChange={(e) => setForm((p) => ({ ...p, person_name: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input type="number" required step="0.01" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm">
          <option value="you_owe">I Owe</option>
          <option value="they_owe">They Owe Me</option>
        </select>
        <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input placeholder="Reason" value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input placeholder="Notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm md:col-span-2" />
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">{editingId ? "Update Loan" : "Add Loan"}</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-red-300">I Owe</h2>
          <div className="mt-3 space-y-2">
            {owes.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-500">
                ◌ No loans in "I Owe" yet.
              </div>
            ) : null}
            {renderLoanList(owes)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-green-300">They Owe Me</h2>
          <div className="mt-3 space-y-2">{renderLoanList(owed)}</div>
        </div>
      </div>
      {paymentModalLoan ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 md:items-center">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addPayment(paymentModalLoan);
            }}
            className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-4"
          >
            <h3 className="text-base font-semibold">Record payment for {paymentModalLoan.person_name}</h3>
            <div className="mt-3 space-y-2">
              <input
                type="number"
                step="0.01"
                placeholder="Payment amount"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <input
                placeholder="Payment note (optional)"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPaymentModalLoan(null)} className="rounded-md border border-zinc-700 px-3 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white">
                Save Payment
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
