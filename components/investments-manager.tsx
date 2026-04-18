"use client";

import { FormEvent, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pushToast } from "@/lib/toast";

export type Investment = {
  id: string;
  name: string;
  type: string;
  platform: string | null;
  amount_invested: number;
  current_value: number | null;
  date: string;
  is_sip: boolean;
  sip_amount: number | null;
  sip_date: number | null;
  account_id: string | null;
  sip_last_posted_month: string | null;
  note: string | null;
};

const TYPES = ["equity", "mutual_fund", "gold", "debt", "crypto", "fd", "other"];
const TYPE_COLORS: Record<string, string> = {
  equity: "#10b981",
  mutual_fund: "#22c55e",
  gold: "#f59e0b",
  debt: "#3b82f6",
  crypto: "#8b5cf6",
  fd: "#14b8a6",
  other: "#94a3b8",
};

const defaultForm = {
  name: "",
  type: "equity",
  platform: "",
  amount_invested: "0",
  current_value: "0",
  date: new Date().toISOString().slice(0, 10),
  is_sip: false,
  sip_amount: "",
  sip_date: "",
  account_id: "",
  note: "",
};

export function InvestmentsManager({
  accounts,
  initialItems,
}: {
  accounts: { id: string; name: string }[];
  initialItems: Investment[];
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [items, setItems] = useState<Investment[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState<Record<string, string>>({});

  const refresh = async () => {
    const { data, error: fetchError } = await supabase
      .from("investments")
      .select(
        "id, name, type, platform, amount_invested, current_value, date, is_sip, sip_amount, sip_date, account_id, sip_last_posted_month, note"
      )
      .order("date", { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setItems((data ?? []) as Investment[]);
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

    if (form.is_sip) {
      if (!form.sip_amount.trim() || !form.sip_date.trim() || !form.account_id) {
        setError("SIP requires amount, day of month, and an account to deduct from.");
        return;
      }
    }

    const payload = {
      user_id: userId,
      name: form.name.trim(),
      type: form.type,
      platform: form.platform.trim() || null,
      amount_invested: Number(form.amount_invested),
      current_value: Number(form.current_value),
      date: form.date,
      is_sip: form.is_sip,
      sip_amount: form.is_sip && form.sip_amount ? Number(form.sip_amount) : null,
      sip_date: form.is_sip && form.sip_date ? Number(form.sip_date) : null,
      account_id: form.is_sip && form.account_id ? form.account_id : null,
      note: form.note.trim() || null,
    };

    const query = editingId
      ? supabase.from("investments").update(payload).eq("id", editingId)
      : supabase.from("investments").insert(payload);
    const { error: upsertError } = await query;
    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setEditingId(null);
    setForm(defaultForm);
    await refresh();
    pushToast({ message: editingId ? "Investment updated" : "Investment added", tone: "success" });
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete investment entry?")) return;
    const { error: deleteError } = await supabase.from("investments").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await refresh();
    pushToast({ message: "Investment deleted", tone: "warning" });
  };

  const addToExistingInvestment = async (item: Investment) => {
    setError(null);
    const addAmount = Number(topupAmount[item.id] ?? "0");
    if (addAmount <= 0) {
      setError("Top-up amount must be greater than zero.");
      return;
    }

    const nextInvested = Number(item.amount_invested) + addAmount;
    const nextCurrent = Number(item.current_value ?? item.amount_invested) + addAmount;
    const nextNote = item.note
      ? `${item.note}\nTop-up: INR ${addAmount.toFixed(2)} on ${new Date()
          .toISOString()
          .slice(0, 10)}`
      : `Top-up: INR ${addAmount.toFixed(2)} on ${new Date().toISOString().slice(0, 10)}`;

    const { error: updateError } = await supabase
      .from("investments")
      .update({
        amount_invested: nextInvested,
        current_value: nextCurrent,
        note: nextNote,
      })
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setTopupAmount((prev) => ({ ...prev, [item.id]: "" }));
    await refresh();
    pushToast({ message: `Added INR ${addAmount.toFixed(2)} to ${item.name}`, tone: "success" });
  };

  const grouped = TYPES.map((type) => ({
    type,
    items: items.filter((item) => item.type === type),
  })).filter((group) => group.items.length > 0);

  const totalInvested = items.reduce((sum, item) => sum + Number(item.amount_invested || 0), 0);
  const totalCurrent = items.reduce(
    (sum, item) => sum + Number(item.current_value ?? item.amount_invested ?? 0),
    0
  );
  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  const allocation = TYPES.map((type) => {
    const value = items
      .filter((item) => item.type === type)
      .reduce((sum, item) => sum + Number(item.current_value ?? item.amount_invested ?? 0), 0);
    return { name: type, value };
  }).filter((item) => item.value > 0);

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="text-lg font-semibold">Investments</h1>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400">Total Invested</p>
            <p className="text-lg font-semibold text-blue-300">INR {totalInvested.toFixed(2)}</p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400">Current Value</p>
            <p className="text-lg font-semibold text-green-300">INR {totalCurrent.toFixed(2)}</p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400">Overall P&L</p>
            <p className={`text-lg font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              INR {pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
            </p>
          </div>
        </div>
      </header>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <form onSubmit={onSubmit} className="grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 md:grid-cols-4">
        <input required placeholder="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm">
          {TYPES.map((type) => (
            <option key={type} value={type}>{type.replaceAll("_", " ")}</option>
          ))}
        </select>
        <input placeholder="Platform" value={form.platform} onChange={(e) => setForm((p) => ({ ...p, platform: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input type="number" step="0.01" required value={form.amount_invested} onChange={(e) => setForm((p) => ({ ...p, amount_invested: e.target.value }))} placeholder="Amount invested" className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input type="number" step="0.01" required value={form.current_value} onChange={(e) => setForm((p) => ({ ...p, current_value: e.target.value }))} placeholder="Current value" className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm">
          <input type="checkbox" checked={form.is_sip} onChange={(e) => setForm((p) => ({ ...p, is_sip: e.target.checked }))} />
          SIP
        </label>
        <input type="number" step="0.01" value={form.sip_amount} onChange={(e) => setForm((p) => ({ ...p, sip_amount: e.target.value }))} placeholder="SIP amount" className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <input type="number" min={1} max={31} value={form.sip_date} onChange={(e) => setForm((p) => ({ ...p, sip_date: e.target.value }))} placeholder="Day of month (1–31)" className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        <select
          value={form.account_id}
          onChange={(e) => setForm((p) => ({ ...p, account_id: e.target.value }))}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm md:col-span-2"
          disabled={!form.is_sip}
        >
          <option value="">SIP deduct from account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Note" className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm md:col-span-2" />
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">{editingId ? "Update" : "Add Investment"}</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-zinc-200">Grouped by type</h2>
          <div className="mt-3 space-y-3">
            {grouped.length === 0 ? <p className="text-sm text-zinc-400">No investments yet.</p> : null}
            {grouped.map((group) => (
              <div key={group.type} className="rounded-md border border-zinc-800 p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">{group.type}</p>
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const itemPnl = Number(item.current_value ?? item.amount_invested) - Number(item.amount_invested);
                    const itemPct =
                      Number(item.amount_invested) > 0
                        ? (itemPnl / Number(item.amount_invested)) * 100
                        : 0;
                    const sipAccountName = item.account_id
                      ? accounts.find((a) => a.id === item.account_id)?.name
                      : null;
                    return (
                      <article key={item.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{item.name}</p>
                            <p className="text-xs text-zinc-400">
                              {item.platform ?? "No platform"} - {item.date}
                            </p>
                            {item.is_sip && item.sip_amount && item.sip_date ? (
                              <p className="mt-1 text-xs text-cyan-300/90">
                                SIP INR {Number(item.sip_amount).toFixed(2)} on day {item.sip_date}
                                {sipAccountName ? ` · from ${sipAccountName}` : " · link account for auto-deduct"}
                                {item.sip_last_posted_month ? ` · last run ${item.sip_last_posted_month}` : null}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-zinc-400">Invested {Number(item.amount_invested).toFixed(2)}</p>
                            <p className="text-xs text-zinc-300">Current {Number(item.current_value ?? item.amount_invested).toFixed(2)}</p>
                            <p className={`text-sm font-semibold ${itemPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                              P&L {itemPnl.toFixed(2)} ({itemPct.toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(item.id);
                              setForm({
                                name: item.name,
                                type: item.type,
                                platform: item.platform ?? "",
                                amount_invested: String(item.amount_invested),
                                current_value: String(item.current_value ?? item.amount_invested),
                                date: item.date,
                                is_sip: item.is_sip,
                                sip_amount: item.sip_amount ? String(item.sip_amount) : "",
                                sip_date: item.sip_date ? String(item.sip_date) : "",
                                account_id: item.account_id ?? "",
                                note: item.note ?? "",
                              });
                            }}
                            className="rounded-md border border-zinc-700 px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button type="button" onClick={() => void onDelete(item.id)} className="rounded-md border border-red-800 px-2 py-1 text-xs text-red-300">
                            Delete
                          </button>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Add amount"
                            value={topupAmount[item.id] ?? ""}
                            onChange={(e) =>
                              setTopupAmount((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void addToExistingInvestment(item)}
                            className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white"
                          >
                            Add Amount
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Allocation by type</h2>
          <div className="mt-3 h-72 min-h-[18rem] min-w-0">
            <ResponsiveContainer width="99%" height="100%">
              <PieChart>
                <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95}>
                  {allocation.map((entry) => (
                    <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `INR ${Number(value ?? 0).toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
