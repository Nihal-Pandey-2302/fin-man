"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pushToast } from "@/lib/toast";

type Account = { id: string; name: string; balance?: number };
type IncomeEntry = {
  id: string;
  source_name: string;
  source_type: string;
  amount: number;
  date: string;
  account_id: string | null;
  note: string | null;
};

function migrationHint(errorMessage: string) {
  if (
    errorMessage.includes("income_entries") ||
    errorMessage.includes("liquid_buffer") ||
    errorMessage.includes("schema cache")
  ) {
    return "Database schema is behind. Run Supabase migrations: supabase db push";
  }
  return errorMessage;
}

export function EarningsManager({
  accounts,
  initialItems,
  initialBuffer,
}: {
  accounts: Account[];
  initialItems: IncomeEntry[];
  initialBuffer: number;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [items, setItems] = useState(initialItems);
  const [buffer, setBuffer] = useState(String(initialBuffer));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    source_name: "",
    source_type: "salary",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    account_id: "",
    note: "",
  });
  const monthKey = new Date().toISOString().slice(0, 7);
  const totalMonthEarnings = items
    .filter((entry) => entry.date.slice(0, 7) === monthKey)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const liquidCash = accounts
  .filter((a) => !a.name.toLowerCase().includes("ppf"))
  .reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const bufferValue = Number(buffer || 0);
  const bufferProgress = bufferValue > 0 ? Math.min(100, (liquidCash / bufferValue) * 100) : 0;

  const reload = async () => {
    const { data, error: fetchError } = await supabase
      .from("income_entries")
      .select("id, source_name, source_type, amount, date, account_id, note")
      .order("date", { ascending: false });
    if (fetchError) {
      setError(migrationHint(fetchError.message));
      return;
    }
    setItems((data ?? []) as IncomeEntry[]);
  };

  const saveBuffer = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const amount = Number(buffer);
    if (Number.isNaN(amount) || amount < 0) {
      setLoading(false);
      setError("Buffer must be zero or greater.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError("No active user session.");
      return;
    }

    const { error: upsertError } = await supabase.from("user_settings").upsert(
      {
        user_id: user.id,
        liquid_buffer: amount,
      },
      { onConflict: "user_id" }
    );
    setLoading(false);
    if (upsertError) {
      setError(migrationHint(upsertError.message));
      return;
    }
    pushToast({ message: "Buffer updated", tone: "success" });
  };

  const addIncome = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const amount = Number(form.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      setLoading(false);
      setError("Income amount must be greater than zero.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError("No active user session.");
      return;
    }

    const { error: incomeError } = await supabase.from("income_entries").insert({
      user_id: user.id,
      source_name: form.source_name.trim(),
      source_type: form.source_type,
      amount,
      date: form.date,
      account_id: form.account_id || null,
      note: form.note.trim() || null,
    });

    if (incomeError) {
      setLoading(false);
      setError(migrationHint(incomeError.message));
      return;
    }

    if (form.account_id) {
      const { data: account } = await supabase
        .from("accounts")
        .select("balance")
        .eq("id", form.account_id)
        .single();
      if (account) {
        await supabase
          .from("accounts")
          .update({ balance: Number(account.balance) + amount })
          .eq("id", form.account_id);
      }
    }

    setLoading(false);
    setForm((prev) => ({ ...prev, source_name: "", amount: "", note: "" }));
    pushToast({ message: "Income added", tone: "success" });
    await reload();
  };

  return (
    <section className="space-y-5 pb-24">
      <header className="rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-900/70 p-5">
        <h1 className="border-l-4 border-blue-500 pl-3 text-lg font-semibold">Earnings</h1>
        <p className="mt-1 text-sm text-zinc-400">Track salary/freelance income and maintain your liquid cash buffer.</p>
      </header>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-xs text-zinc-400">Total earnings this month</p>
        <p className="metric-value mt-1 text-green-300">
          <span className="rupee-sign">₹</span> {totalMonthEarnings.toFixed(2)}
        </p>
      </div>
      {error ? <p className="rounded-xl border border-red-900/70 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={saveBuffer} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-zinc-200">Liquid buffer</h2>
          <p className="mt-1 text-xs text-zinc-500">Minimum liquid cash you want untouched.</p>
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Liquid cash</span>
              <span className="text-zinc-300"><span className="rupee-sign">₹</span> {liquidCash.toFixed(2)}</span>
            </div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Buffer target</span>
              <span className="text-zinc-300"><span className="rupee-sign">₹</span> {bufferValue.toFixed(2)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800/80">
              <div
                className={`h-full rounded-full ${liquidCash >= bufferValue ? "bg-green-500" : "bg-yellow-500"}`}
                style={{ width: `${bufferProgress}%` }}
              />
            </div>
          </div>
          <input
            type="number"
            min={0}
            step="0.01"
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            Save Buffer
          </button>
        </form>

        <form onSubmit={addIncome} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-zinc-200">Add income</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <input
              required
              value={form.source_name}
              onChange={(e) => setForm((prev) => ({ ...prev, source_name: e.target.value }))}
              placeholder="Source name"
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
            />
            <select
              value={form.source_type}
              onChange={(e) => setForm((prev) => ({ ...prev, source_type: e.target.value }))}
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
            >
              <option value="salary">Salary</option>
              <option value="freelance">Freelance</option>
              <option value="hackathon">Hackathon</option>
              <option value="bounty">Bounty</option>
              <option value="misc">Misc</option>
              <option value="other">Other</option>
            </select>
            <input
              required
              type="number"
              min={0.01}
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder="Amount"
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
            />
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
            />
            <select
              value={form.account_id}
              onChange={(e) => setForm((prev) => ({ ...prev, account_id: e.target.value }))}
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
            >
              <option value="">Do not add to account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <input
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="Note (optional)"
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white transition hover:bg-green-500 disabled:opacity-60"
          >
            Record Income
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Recent earnings</h2>
        <div className="mt-3 space-y-2">
          {items.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm text-zinc-500">
              <span className="rupee-sign text-base">₹</span>
              <span>No earnings recorded yet</span>
            </div>
          ) : null}
          {items.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm">
              <span>
                {entry.source_name} • {entry.source_type}
              </span>
              <span className="metric-value text-emerald-300">
                <span className="rupee-sign">₹</span> {Number(entry.amount).toFixed(2)} ({entry.date})
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
