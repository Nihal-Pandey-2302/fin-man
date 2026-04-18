"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { EXPENSE_CATEGORIES, categoryMeta } from "@/lib/finance-config";
import { pushToast } from "@/lib/toast";

type Account = { id: string; name: string; balance: number; currency: string };
export type Expense = {
  id: string;
  amount: number;
  category: string;
  subcategory: string | null;
  note: string | null;
  date: string;
  account_id: string | null;
  is_autopay: boolean;
  account?: { name: string; currency: string } | null;
};

const PAGE_SIZE = 20;

const defaultForm = {
  amount: "0",
  category: "misc",
  subcategory: "",
  note: "",
  date: new Date().toISOString().slice(0, 10),
  account_id: "",
};

export function ExpensesManager({
  accounts,
  initialExpenses,
  initialCount,
  initialMonthFilter,
}: {
  accounts: Account[];
  initialExpenses: Expense[];
  initialCount: number;
  initialMonthFilter: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [totalCount, setTotalCount] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [monthFilter, setMonthFilter] = useState(initialMonthFilter);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");

  const loadExpenses = async (nextPage = page) => {
    setLoading(true);
    setError(null);

    const from = (nextPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("expenses")
      .select("id, amount, category, subcategory, note, date, account_id, is_autopay, account:accounts(name, currency)", {
        count: "exact",
      })
      .order("date", { ascending: false })
      .range(from, to);

    if (categoryFilter) query = query.eq("category", categoryFilter);
    if (accountFilter) query = query.eq("account_id", accountFilter);
    if (monthFilter) {
      const monthStart = `${monthFilter}-01`;
      const monthEndDate = new Date(`${monthStart}T00:00:00.000Z`);
      monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
      const monthEnd = monthEndDate.toISOString().slice(0, 10);
      query = query.gte("date", monthStart).lt("date", monthEnd);
    }

    const { data, count, error: fetchError } = await query;
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const mapped = (data ?? []).map((item) => ({
      ...item,
      account: Array.isArray(item.account) ? item.account[0] ?? null : item.account,
    })) as Expense[];
    setExpenses(mapped);
    setTotalCount(count ?? 0);
    setLoading(false);
  };

  const resetForm = () => {
    setForm(defaultForm);
    setEditing(null);
  };

  const adjustAccountBalance = async (accountId: string | null, delta: number) => {
    if (!accountId || !delta) return;
    const { data: account } = await supabase.from("accounts").select("balance").eq("id", accountId).single();
    if (!account) return;
    await supabase
      .from("accounts")
      .update({ balance: Number(account.balance) + delta })
      .eq("id", accountId);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const nextAmount = Number(form.amount);
    if (nextAmount <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("No active user session.");
      return;
    }

    const payload = {
      user_id: userId,
      amount: nextAmount,
      category: form.category,
      subcategory: form.subcategory || null,
      note: form.note || null,
      date: form.date,
      account_id: form.account_id || null,
      currency: "INR",
    };

    if (editing) {
      await adjustAccountBalance(editing.account_id, Number(editing.amount));
      await adjustAccountBalance(payload.account_id, -nextAmount);
      const { error: updateError } = await supabase.from("expenses").update(payload).eq("id", editing.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const { error: createError } = await supabase.from("expenses").insert(payload);
      if (createError) {
        setError(createError.message);
        return;
      }
      await adjustAccountBalance(payload.account_id, -nextAmount);
    }

    setOpenModal(false);
    resetForm();
    await loadExpenses(1);
    setPage(1);
    pushToast({ message: editing ? "Expense updated" : "Expense added", tone: "success" });
  };

  const onDelete = async (expense: Expense) => {
    let shouldRevert = true;
    if (expense.is_autopay) {
      shouldRevert = window.confirm(
        "This is an autopay expense. Also revert account balance?"
      );
    }
    if (!window.confirm("Delete this expense?")) return;

    const { error: deleteError } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (shouldRevert) {
      await adjustAccountBalance(expense.account_id, Number(expense.amount));
    }
    await loadExpenses(page);
    pushToast({ message: "Expense deleted", tone: "warning" });
  };

  const openEditModal = (expense: Expense) => {
    setEditing(expense);
    setForm({
      amount: String(expense.amount),
      category: expense.category,
      subcategory: expense.subcategory ?? "",
      note: expense.note ?? "",
      date: expense.date,
      account_id: expense.account_id ?? "",
    });
    setOpenModal(true);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <section className="space-y-4 pb-24">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="text-lg font-semibold">Expenses</h1>
        <p className="mt-1 text-sm text-zinc-400">Track every rupee with account-linked balance updates.</p>
      </header>

      <div className="grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 md:grid-cols-4">
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category.key} value={category.key}>
              {category.emoji} {category.label}
            </option>
          ))}
        </select>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setPage(1);
            void loadExpenses(1);
          }}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Apply Filters
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="space-y-2">
        {loading ? <p className="text-sm text-zinc-400">Loading expenses...</p> : null}
        {!loading && expenses.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-400">
            No expenses found for current filters.
          </p>
        ) : null}
        {expenses.map((expense) => {
          const meta = categoryMeta(expense.category);
          return (
            <article key={expense.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${meta.colorClass}`}>
                    {meta.emoji} {meta.label}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {expense.subcategory ?? "General"} - {expense.account?.name ?? "No account"}
                  </p>
                </div>
                <p className="text-sm font-semibold text-red-300">INR {Number(expense.amount).toFixed(2)}</p>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{expense.date}</p>
              {expense.note ? <p className="mt-1 text-sm text-zinc-300">{expense.note}</p> : null}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => openEditModal(expense)} className="rounded-md border border-zinc-700 px-2 py-1 text-xs">
                  Edit
                </button>
                <button type="button" onClick={() => void onDelete(expense)} className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-300">
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm">
        <span>
          Page {page} / {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              const next = Math.max(1, page - 1);
              setPage(next);
              void loadExpenses(next);
            }}
            className="rounded-md border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => {
              const next = Math.min(totalPages, page + 1);
              setPage(next);
              void loadExpenses(next);
            }}
            className="rounded-md border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          resetForm();
          setOpenModal(true);
        }}
        className="fixed bottom-20 right-4 z-40 rounded-full bg-blue-600 px-5 py-3 text-2xl leading-none text-white shadow-lg hover:bg-blue-500 md:bottom-6"
      >
        +
      </button>

      {openModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 md:items-center">
          <form onSubmit={onSubmit} className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-base font-semibold">{editing ? "Edit Expense" : "Add Expense"}</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <input
                type="number"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="Amount"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.emoji} {category.label}
                  </option>
                ))}
              </select>
              <select
                value={form.account_id}
                onChange={(e) => setForm((prev) => ({ ...prev, account_id: e.target.value }))}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                <option value="">No account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <input
                value={form.subcategory}
                onChange={(e) => setForm((prev) => ({ ...prev, subcategory: e.target.value }))}
                placeholder="Subcategory"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <input
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Note"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpenModal(false)} className="rounded-md border border-zinc-700 px-3 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">
                {editing ? "Save Changes" : "Add Expense"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
