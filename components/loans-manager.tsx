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
  const [paymentAmount, setPaymentAmount] = useState<Record<string, string>>({});
  const [paymentNote, setPaymentNote] = useState<Record<string, string>>({});

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
    const amount = Number(paymentAmount[loan.id] ?? "0");
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
        note: paymentNote[loan.id] ?? null,
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
    setPaymentAmount((prev) => ({ ...prev, [loan.id]: "" }));
    setPaymentNote((prev) => ({ ...prev, [loan.id]: "" }));
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

  const renderLoanList = (list: Loan[]) =>
    list.map((loan) => {
      const overdue =
        !!loan.due_date && loan.due_date < today && loan.status !== "settled";
      const loanPayments = payments.filter((payment) => payment.loan_id === loan.id);
      return (
        <article key={loan.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{loan.person_name}</p>
              <p className="text-xs text-zinc-400">
                INR {Number(loan.amount).toFixed(2)} • Paid {Number(loan.amount_paid).toFixed(2)}
              </p>
              <p className="text-xs text-zinc-500">
                {loan.reason ?? "No reason"} • {loan.date}
              </p>
              {loan.due_date ? (
                <p className={`text-xs ${overdue ? "text-red-400" : "text-zinc-400"}`}>
                  Due {loan.due_date} {overdue ? "(Overdue)" : ""}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <p
                className={`text-xs font-semibold ${
                  loan.status === "settled"
                    ? "text-green-400"
                    : loan.status === "partially_paid"
                    ? "text-yellow-300"
                    : "text-zinc-300"
                }`}
              >
                {loan.status}
              </p>
            </div>
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <input
              type="number"
              step="0.01"
              placeholder="Payment amount"
              value={paymentAmount[loan.id] ?? ""}
              onChange={(e) => setPaymentAmount((p) => ({ ...p, [loan.id]: e.target.value }))}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
            />
            <input
              placeholder="Payment note"
              value={paymentNote[loan.id] ?? ""}
              onChange={(e) => setPaymentNote((p) => ({ ...p, [loan.id]: e.target.value }))}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs md:col-span-2"
            />
            <button type="button" onClick={() => void addPayment(loan)} className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white">
              Record Payment
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
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
                    {payment.date}: INR {Number(payment.amount).toFixed(2)} {payment.note ? `- ${payment.note}` : ""}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      );
    });

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="text-lg font-semibold">Loans</h1>
        <p className="mt-1 text-sm text-zinc-400">Track liabilities and receivables with partial payment logs.</p>
      </header>
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
          <div className="mt-3 space-y-2">{renderLoanList(owes)}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-green-300">They Owe Me</h2>
          <div className="mt-3 space-y-2">{renderLoanList(owed)}</div>
        </div>
      </div>
    </section>
  );
}
