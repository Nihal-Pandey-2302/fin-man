"use client";

import { FormEvent, useMemo, useState } from "react";
import { BILLING_CYCLES, EXPENSE_CATEGORIES, advanceDateByCycle } from "@/lib/finance-config";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pushToast } from "@/lib/toast";

type Account = { id: string; name: string };
export type Subscription = {
  id: string;
  name: string;
  amount: number;
  billing_cycle: string;
  next_due_date: string | null;
  account_id: string | null;
  category: string | null;
  auto_insert: boolean;
  is_active: boolean;
};

const defaultForm = {
  name: "",
  amount: "0",
  billing_cycle: "monthly",
  next_due_date: new Date().toISOString().slice(0, 10),
  account_id: "",
  category: "subscription",
  auto_insert: true,
};

const suggestedSubs = ["Netflix", "Spotify", "YouTube Premium", "Prime Video", "ChatGPT Plus"];

function daysUntil(dateIso: string | null) {
  if (!dateIso) return null;
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const due = new Date(`${dateIso}T00:00:00.000Z`);
  return Math.ceil((due.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
}

function monthlyEquivalent(amount: number, cycle: string) {
  if (cycle === "weekly") return amount * 4.33;
  if (cycle === "quarterly") return amount / 3;
  if (cycle === "yearly") return amount / 12;
  return amount;
}

function logoTone(name: string) {
  const tones = ["bg-blue-500/20 text-blue-300", "bg-purple-500/20 text-purple-300", "bg-green-500/20 text-green-300", "bg-yellow-500/20 text-yellow-300", "bg-pink-500/20 text-pink-300"];
  const index = name.length % tones.length;
  return tones[index];
}

export function SubscriptionsManager({
  accounts,
  initialItems,
}: {
  accounts: Account[];
  initialItems: Subscription[];
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [items, setItems] = useState<Subscription[]>(initialItems);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const recurringMonthlyTotal = items.reduce(
    (sum, item) => sum + monthlyEquivalent(Number(item.amount || 0), item.billing_cycle),
    0
  );

  const load = async () => {
    const { data, error: fetchError } = await supabase
      .from("subscriptions")
      .select("id, name, amount, billing_cycle, next_due_date, account_id, category, auto_insert, is_active")
      .order("next_due_date", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setItems((data ?? []) as Subscription[]);
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

  const triggerAutopayNow = async (item: Subscription) => {
    const today = new Date().toISOString().slice(0, 10);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { error: insertError } = await supabase.from("expenses").insert({
      user_id: userId,
      amount: item.amount,
      category: item.category ?? "subscription",
      currency: "INR",
      subcategory: item.name,
      note: `Auto: ${item.name}`,
      date: today,
      account_id: item.account_id,
      subscription_id: item.id,
      is_autopay: true,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }

    await adjustAccountBalance(item.account_id, -Number(item.amount));
    await supabase
      .from("subscriptions")
      .update({
        next_due_date: advanceDateByCycle(today, item.billing_cycle),
        next_billing_date: advanceDateByCycle(today, item.billing_cycle),
      })
      .eq("id", item.id);
    setToast(`₹${Number(item.amount).toFixed(2)} auto-deducted for ${item.name}`);
    pushToast({ message: `₹${Number(item.amount).toFixed(2)} auto-deducted for ${item.name}`, tone: "warning" });
    await load();
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
      name: form.name.trim(),
      amount: Number(form.amount),
      billing_cycle: form.billing_cycle,
      next_billing_date: form.next_due_date,
      next_due_date: form.next_due_date,
      account_id: form.account_id || null,
      category: form.category,
      auto_insert: form.auto_insert,
      is_active: true,
    };
    const query = editingId
      ? supabase.from("subscriptions").update(payload).eq("id", editingId)
      : supabase.from("subscriptions").insert(payload);
    const { error: upsertError } = await query;
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setEditingId(null);
    setForm(defaultForm);
    await load();
    pushToast({ message: editingId ? "Subscription updated" : "Subscription added", tone: "success" });
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete subscription? Expense history will remain.")) return;
    const { error: deleteError } = await supabase.from("subscriptions").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await load();
    pushToast({ message: "Subscription deleted", tone: "warning" });
  };

  return (
    <section className="space-y-4 pb-24">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="border-l-4 border-blue-500 pl-3 text-lg font-semibold">Subscriptions</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Recurring payments with auto-insert engine and manual trigger.
        </p>
      </header>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-xs text-zinc-400">Monthly recurring total</p>
        <p className="metric-value mt-1 text-zinc-100">
          <span className="rupee-sign">₹</span> {recurringMonthlyTotal.toFixed(2)}
        </p>
      </div>

      {toast ? (
        <div className="rounded-md border border-yellow-700 bg-zinc-900 p-3 text-sm text-yellow-200">
          {toast}
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <form onSubmit={onSubmit} className="grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 md:grid-cols-4">
        <input
          required
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <input
          type="number"
          required
          step="0.01"
          value={form.amount}
          onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <select
          value={form.billing_cycle}
          onChange={(e) => setForm((prev) => ({ ...prev, billing_cycle: e.target.value }))}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        >
          {BILLING_CYCLES.map((cycle) => (
            <option key={cycle} value={cycle}>
              {cycle}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={form.next_due_date}
          onChange={(e) => setForm((prev) => ({ ...prev, next_due_date: e.target.value }))}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
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
        <label className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={form.auto_insert}
            onChange={(e) => setForm((prev) => ({ ...prev, auto_insert: e.target.checked }))}
          />
          Auto-insert
        </label>
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">
          {editingId ? "Update" : "Add Subscription"}
        </button>
      </form>

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="empty-state text-sm">◌ No subscriptions yet. Try adding one:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestedSubs.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      name,
                      amount: prev.amount === "0" ? "" : prev.amount,
                    }))
                  }
                  className="rounded-full border border-zinc-700 bg-transparent px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/70"
                >
                  + {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${logoTone(item.name)}`}>
                {item.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.name}</p>
                <p className="text-xs text-zinc-400">{item.billing_cycle}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm text-zinc-100">
                  <span className="rupee-sign">₹</span> {Number(item.amount).toFixed(2)}
                </p>
                {(() => {
                  const remaining = daysUntil(item.next_due_date);
                  const badgeTone =
                    remaining === null
                      ? "bg-zinc-700/60 text-zinc-300"
                      : remaining < 3
                        ? "bg-red-500/20 text-red-300"
                        : remaining <= 7
                          ? "bg-yellow-500/20 text-yellow-200"
                          : "bg-green-500/20 text-green-300";
                  return (
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${badgeTone}`}>
                      {remaining === null ? "No due date" : remaining < 0 ? `${Math.abs(remaining)}d overdue` : `in ${remaining} days`}
                    </span>
                  );
                })()}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void triggerAutopayNow(item)}
                  className="rounded-md border border-yellow-700 px-2 py-1 text-xs text-yellow-200"
                  aria-label="Trigger subscription now"
                >
                  ▶ Trigger
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(item.id);
                    setForm({
                      name: item.name,
                      amount: String(item.amount),
                      billing_cycle: item.billing_cycle,
                      next_due_date: item.next_due_date ?? new Date().toISOString().slice(0, 10),
                      account_id: item.account_id ?? "",
                      category: item.category ?? "subscription",
                      auto_insert: item.auto_insert,
                    });
                  }}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs"
                  aria-label="Edit subscription"
                >
                  ✎ Edit
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(item.id)}
                  className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-300"
                  aria-label="Delete subscription"
                >
                  🗑 Delete
                </button>
              </div>
          </article>
        ))}
      </div>
    </section>
  );
}
