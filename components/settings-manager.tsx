"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { EXPENSE_CATEGORIES } from "@/lib/finance-config";
import { pushToast } from "@/lib/toast";

type Account = { id: string; name: string };
type Budget = { id: string; category: string; monthly_limit: number; month: number; year: number };
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
  const [budgetMonth, setBudgetMonth] = useState(String(new Date().getMonth() + 1));
  const [budgetYear, setBudgetYear] = useState(String(new Date().getFullYear()));

  const refresh = async () => {
    const [bRes, pRes, sRes] = await Promise.all([
      supabase.from("budgets").select("id, category, monthly_limit, month, year").order("year", { ascending: false }),
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
    const { error: upsertError } = await supabase.from("budgets").upsert({
      user_id: userId,
      category: budgetCategory,
      monthly_limit: Number(budgetLimit),
      month: Number(budgetMonth),
      year: Number(budgetYear),
    });
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    pushToast({ message: "Budget saved", tone: "success" });
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

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Quick-add presets, default account, budget limits, and export.</p>
      </header>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Default account</h2>
          <select
            value={settings?.default_account_id ?? ""}
            onChange={(e) => void saveDefaultAccount(e.target.value)}
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="">None</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void exportCsv()} className="mt-3 rounded-md bg-blue-600 px-3 py-2 text-sm text-white">
            Export expenses CSV
          </button>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Add quick-add preset</h2>
          <form onSubmit={addPreset} className="mt-2 grid gap-2 md:grid-cols-2">
            <input required placeholder="Preset name" value={presetForm.name} onChange={(e) => setPresetForm((p) => ({ ...p, name: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
            <select value={presetForm.category} onChange={(e) => setPresetForm((p) => ({ ...p, category: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm">
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category.key} value={category.key}>{category.emoji} {category.label}</option>
              ))}
            </select>
            <input placeholder="Subcategory" value={presetForm.subcategory} onChange={(e) => setPresetForm((p) => ({ ...p, subcategory: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
            <input placeholder="Note" value={presetForm.note} onChange={(e) => setPresetForm((p) => ({ ...p, note: e.target.value }))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white md:col-span-2">Save preset</button>
          </form>
          <div className="mt-3 space-y-2">
            {presets.map((preset) => (
              <div key={preset.id} className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2 text-sm">
                <span>{preset.name} • {preset.category} • {preset.subcategory ?? "general"}</span>
                <button type="button" onClick={() => void deletePreset(preset.id)} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300">Delete</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Budget limits</h2>
        <form onSubmit={addBudget} className="mt-2 grid gap-2 md:grid-cols-5">
          <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm">
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category.key} value={category.key}>{category.label}</option>
            ))}
          </select>
          <input type="number" step="0.01" value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
          <input type="number" min={1} max={12} value={budgetMonth} onChange={(e) => setBudgetMonth(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
          <input type="number" min={2000} value={budgetYear} onChange={(e) => setBudgetYear(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white">Save budget</button>
        </form>
        <div className="mt-3 space-y-2">
          {budgets.map((budget) => (
            <div key={budget.id} className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-200">
              {budget.category} • INR {Number(budget.monthly_limit).toFixed(2)} • {budget.month}/{budget.year}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
