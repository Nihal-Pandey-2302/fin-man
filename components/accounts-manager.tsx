"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pushToast } from "@/lib/toast";

type Account = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  color: string | null;
  icon: string | null;
  created_at: string;
};

const accountTypes = ["bank", "cash", "wallet", "crypto"] as const;

const initialForm = {
  name: "",
  type: "bank",
  balance: "0",
  currency: "INR",
  color: "#3b82f6",
  icon: "💳",
};

export function AccountsManager({
  initialAccounts,
  userId,
}: {
  initialAccounts: Account[];
  userId: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [adjustValues, setAdjustValues] = useState<Record<string, string>>({});
  const [adjustNotes, setAdjustNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = async () => {
    if (!userId) {
      setError("No active user session.");
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setAccounts((data ?? []) as Account[]);
  };

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!userId) return;

    const payload = {
      user_id: userId,
      name: form.name.trim(),
      type: form.type,
      balance: Number(form.balance),
      currency: form.currency.trim().toUpperCase() || "INR",
      color: form.color.trim() || null,
      icon: form.icon.trim() || null,
    };

    const query = editingId
      ? supabase.from("accounts").update(payload).eq("id", editingId)
      : supabase.from("accounts").insert(payload);

    const { error: upsertError } = await query;
    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    resetForm();
    await loadAccounts();
    pushToast({ message: editingId ? "Account updated" : "Account added", tone: "success" });
  };

  const startEdit = (account: Account) => {
    setEditingId(account.id);
    setForm({
      name: account.name,
      type: account.type,
      balance: String(account.balance),
      currency: account.currency,
      color: account.color ?? "#3b82f6",
      icon: account.icon ?? "💳",
    });
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this account?")) return;
    setError(null);
    const { error: deleteError } = await supabase.from("accounts").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await loadAccounts();
    pushToast({ message: "Account deleted", tone: "warning" });
  };

  const adjustBalance = async (account: Account) => {
    setError(null);
    const delta = Number(adjustValues[account.id] ?? "0");
    const note = (adjustNotes[account.id] ?? "").trim();

    if (!delta || !note || !userId) {
      setError("Adjustment amount and reason note are required.");
      return;
    }

    const nextBalance = Number(account.balance) + delta;
    const { error: updateError } = await supabase
      .from("accounts")
      .update({ balance: nextBalance })
      .eq("id", account.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: delta >= 0 ? "income" : "expense",
      amount: Math.abs(delta),
      currency: account.currency,
      category: "balance_adjustment",
      note,
      date: new Date().toISOString().slice(0, 10),
      account_id: account.id,
    });

    if (transactionError) {
      setError(transactionError.message);
      return;
    }

    setAdjustValues((prev) => ({ ...prev, [account.id]: "" }));
    setAdjustNotes((prev) => ({ ...prev, [account.id]: "" }));
    await loadAccounts();
    pushToast({ message: "Balance adjusted", tone: "success" });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="text-lg font-semibold">Accounts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Add, edit, delete, and manually adjust balances with an audit note.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 grid gap-2 md:grid-cols-6">
          <input
            required
            placeholder="Account name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            {accountTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            value={form.balance}
            onChange={(e) => setForm((prev) => ({ ...prev, balance: e.target.value }))}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.currency}
            onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              {editingId ? "Update" : "Add"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="space-y-2">
        {accounts.map((account) => (
          <article
            key={account.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {account.icon} {account.name}
                </p>
                <p className="text-xs text-zinc-400">{account.type}</p>
              </div>
              <p className={account.balance >= 0 ? "text-green-400" : "text-red-400"}>
                {account.currency} {Number(account.balance).toFixed(2)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startEdit(account)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void onDelete(account.id)}
                className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-300"
              >
                Delete
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <input
                type="number"
                step="0.01"
                placeholder="Amount (+/-)"
                value={adjustValues[account.id] ?? ""}
                onChange={(e) =>
                  setAdjustValues((prev) => ({ ...prev, [account.id]: e.target.value }))
                }
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
              />
              <input
                placeholder="Reason note"
                value={adjustNotes[account.id] ?? ""}
                onChange={(e) =>
                  setAdjustNotes((prev) => ({ ...prev, [account.id]: e.target.value }))
                }
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs md:col-span-2"
              />
              <button
                type="button"
                onClick={() => void adjustBalance(account)}
                className="rounded-md bg-yellow-600 px-2 py-1 text-xs font-medium text-black"
              >
                Adjust
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
