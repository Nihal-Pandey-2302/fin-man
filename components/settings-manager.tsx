"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { EXPENSE_CATEGORIES } from "@/lib/finance-config";
import { pushToast } from "@/lib/toast";

type Account = { id: string; name: string; balance?: number };
type Budget = {
  id: string;
  category: string;
  monthly_limit: number;
  period: "daily" | "weekly" | "monthly";
  period_start: string;
  month?: number;
  year?: number;
};
type Preset = { id: string; name: string; category: string; subcategory: string | null; note: string | null };
type UserSettings = { id: string; default_account_id: string | null; currency: string };

const defaultPreset = { name: "", category: "food", subcategory: "", note: "" };

export function SettingsManager({
  accounts,
  initialBudgets,
  initialPresets,
  initialSettings,
}: {
  accounts: Account[];
  initialBudgets: Budget[];
  initialPresets: Preset[];
  initialSettings: UserSettings | null;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [budgets, setBudgets] = useState(initialBudgets);
  const [presets, setPresets] = useState(initialPresets);
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);
  const [presetForm, setPresetForm] = useState(defaultPreset);
  const [budgetCategory, setBudgetCategory] = useState("food");
  const [budgetLimit, setBudgetLimit] = useState("0");
  const [budgetPeriod, setBudgetPeriod] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [budgetStartDate, setBudgetStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);

  const refresh = async () => {
    const [bRes, pRes, sRes] = await Promise.all([
      supabase
        .from("budgets")
        .select("id, category, monthly_limit, period, period_start, month, year")
        .order("period_start", { ascending: false }),
      supabase.from("quick_add_presets").select("id, name, category, subcategory, note").order("created_at", { ascending: false }),
      supabase.from("user_settings").select("id, default_account_id, currency").maybeSingle(),
    ]);
    if (bRes.error || pRes.error || sRes.error) {
      setError(bRes.error?.message ?? pRes.error?.message ?? sRes.error?.message ?? "Failed loading settings");
      return;
    }
    setBudgets((bRes.data ?? []) as Budget[]);
    setPresets((pRes.data ?? []) as Preset[]);
    setSettings((sRes.data ?? null) as UserSettings | null);
  };

  const addPreset = async (event: FormEvent) => {
    event.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { error: insertError } = await supabase.from("quick_add_presets").insert({
      user_id: userId,
      name: presetForm.name.trim(),
      category: presetForm.category,
      subcategory: presetForm.subcategory.trim() || null,
      note: presetForm.note.trim() || null,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setPresetForm(defaultPreset);
    pushToast({ message: "Quick-add preset saved", tone: "success" });
    await refresh();
  };

  const deletePreset = async (id: string) => {
    if (!window.confirm("Delete this quick-add preset?")) return;
    const { error: deleteError } = await supabase.from("quick_add_presets").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    pushToast({ message: "Preset deleted", tone: "warning" });
    await refresh();
  };

  const saveDefaultAccount = async (accountId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { error: upsertError } = await supabase.from("user_settings").upsert({
      user_id: userId,
      default_account_id: accountId || null,
      currency: settings?.currency ?? "INR",
    });
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    pushToast({ message: "Default account saved", tone: "success" });
    await refresh();
  };

  const addBudget = async (event: FormEvent) => {
    event.preventDefault();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const payload = {
      user_id: userId,
      category: budgetCategory,
      monthly_limit: Number(budgetLimit),
      period: budgetPeriod,
      period_start: budgetStartDate,
      month: new Date(`${budgetStartDate}T00:00:00.000Z`).getUTCMonth() + 1,
      year: new Date(`${budgetStartDate}T00:00:00.000Z`).getUTCFullYear(),
    };
    const query = editingBudgetId
      ? supabase.from("budgets").update(payload).eq("id", editingBudgetId)
      : supabase.from("budgets").upsert(payload, { onConflict: "user_id,category,period,period_start" });
    const { error: upsertError } = await query;
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setEditingBudgetId(null);
    setBudgetCategory("food");
    setBudgetLimit("0");
    setBudgetPeriod("monthly");
    setBudgetStartDate(new Date().toISOString().slice(0, 10));
    pushToast({ message: "Budget saved", tone: "success" });
    await refresh();
  };

  const deleteBudget = async (id: string) => {
    if (!window.confirm("Delete this budget?")) return;
    const { error: deleteError } = await supabase.from("budgets").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    pushToast({ message: "Budget deleted", tone: "warning" });
    await refresh();
  };

  const exportCsv = async () => {
    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("date, amount, category, subcategory, note, is_autopay")
      .order("date", { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    const lines = [
      ["date", "amount", "category", "subcategory", "note", "is_autopay"].join(","),
      ...(data ?? []).map((row) =>
        [row.date, row.amount, row.category, row.subcategory ?? "", (row.note ?? "").replaceAll(",", " "), row.is_autopay ? "true" : "false"].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast({ message: "Expenses CSV exported", tone: "success" });
  };

  const exportAllJson = async () => {
    const [expensesRes, accountsRes, presetsRes, budgetsRes, settingsRes, subsRes, incomeRes, investmentsRes, loansRes] =
      await Promise.all([
        supabase.from("expenses").select("*").order("date", { ascending: false }),
        supabase.from("accounts").select("*").order("created_at", { ascending: false }),
        supabase.from("quick_add_presets").select("*").order("created_at", { ascending: false }),
        supabase.from("budgets").select("*").order("period_start", { ascending: false }),
        supabase.from("user_settings").select("*").maybeSingle(),
        supabase.from("subscriptions").select("*").order("next_due_date", { ascending: true }),
        supabase.from("income_entries").select("*").order("date", { ascending: false }),
        supabase.from("investments").select("*").order("date", { ascending: false }),
        supabase.from("loans").select("*").order("date", { ascending: false }),
      ]);
    const firstError =
      expensesRes.error ??
      accountsRes.error ??
      presetsRes.error ??
      budgetsRes.error ??
      settingsRes.error ??
      subsRes.error ??
      incomeRes.error ??
      investmentsRes.error ??
      loansRes.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    const payload = {
      exported_at: new Date().toISOString(),
      expenses: expensesRes.data ?? [],
      accounts: accountsRes.data ?? [],
      presets: presetsRes.data ?? [],
      budgets: budgetsRes.data ?? [],
      settings: settingsRes.data ?? null,
      subscriptions: subsRes.data ?? [],
      income_entries: incomeRes.data ?? [],
      investments: investmentsRes.data ?? [],
      loans: loansRes.data ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `finance-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast({ message: "Full JSON export ready", tone: "success" });
  };

  const selectedAccount = accounts.find((account) => account.id === (settings?.default_account_id ?? ""));

  return (
    <section className="space-y-6 pb-24">
      <header className="rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900 to-zinc-900/70 p-5">
        <h1 className="border-l-4 border-blue-500 pl-3 text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Preferences, presets, budgets, and data export controls.</p>
      </header>
      {error ? <p className="rounded-xl border border-red-900/70 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Preferences</h2>
        <p className="mt-1 text-xs text-zinc-500">Set defaults used across forms and flows.</p>
        <div className="mt-3">
          <p className="text-xs text-zinc-400">Default account</p>
          <select
            value={settings?.default_account_id ?? ""}
            onChange={(e) => void saveDefaultAccount(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm"
          >
            <option value="">None</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-zinc-500">
            Current selection: {selectedAccount ? `${selectedAccount.name} • ` : "None"}
            {selectedAccount ? (
              <>
                <span className="rupee-sign">₹</span> {Number(selectedAccount.balance ?? 0).toFixed(2)}
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Quick-add Presets</h2>
        <p className="mt-1 text-xs text-zinc-500">Save frequently used expense templates.</p>
        <form onSubmit={addPreset} className="mt-3 grid gap-2 md:grid-cols-2">
          <input required placeholder="Preset name" value={presetForm.name} onChange={(e) => setPresetForm((p) => ({ ...p, name: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm" />
          <select value={presetForm.category} onChange={(e) => setPresetForm((p) => ({ ...p, category: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm">
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category.key} value={category.key}>{category.emoji} {category.label}</option>
            ))}
          </select>
          <input placeholder="Subcategory" value={presetForm.subcategory} onChange={(e) => setPresetForm((p) => ({ ...p, subcategory: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm" />
          <input placeholder="Note" value={presetForm.note} onChange={(e) => setPresetForm((p) => ({ ...p, note: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-500 md:col-span-2">Save preset</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.length === 0 ? <p className="empty-state text-sm">◌ No presets saved yet.</p> : null}
          {presets.map((preset) => (
            <span key={preset.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-950/70 px-2.5 py-1 text-xs text-zinc-300">
              {preset.name}
              <button type="button" onClick={() => void deletePreset(preset.id)} className="rounded-full px-1 text-red-300 hover:bg-zinc-800" aria-label={`Delete ${preset.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Budgets</h2>
        <p className="mt-1 text-xs text-zinc-500">Create and manage period-based spending limits.</p>
        <form onSubmit={addBudget} className="mt-3 grid gap-2 md:grid-cols-5">
          <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm">
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category.key} value={category.key}>{category.label}</option>
            ))}
          </select>
          <input type="number" step="0.01" value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm" />
          <select value={budgetPeriod} onChange={(e) => setBudgetPeriod(e.target.value as "daily" | "weekly" | "monthly")} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input type="date" value={budgetStartDate} onChange={(e) => setBudgetStartDate(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-500">{editingBudgetId ? "Update budget" : "Save budget"}</button>
        </form>
        <div className="mt-3 space-y-2">
          {budgets.length === 0 ? <p className="empty-state text-sm">◌ No budgets configured yet.</p> : null}
          {budgets.map((budget) => (
            <div key={budget.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200">
              <span>{budget.category} • <span className="rupee-sign">₹</span> {Number(budget.monthly_limit).toFixed(2)} • {budget.period} from {budget.period_start}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingBudgetId(budget.id);
                    setBudgetCategory(budget.category);
                    setBudgetLimit(String(Number(budget.monthly_limit)));
                    setBudgetPeriod(budget.period ?? "monthly");
                    setBudgetStartDate(budget.period_start);
                  }}
                  className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
                >
                  Edit
                </button>
                <button type="button" onClick={() => void deleteBudget(budget.id)} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Data</h2>
        <p className="mt-1 text-xs text-zinc-500">Export your records for backup or migration.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportCsv()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-500">
            Export expenses CSV
          </button>
          <button type="button" onClick={() => void exportAllJson()} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
            Export all as JSON
          </button>
        </div>
      </div>
    </section>
  );
}
