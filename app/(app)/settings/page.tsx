import { SettingsManager } from "@/components/settings-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const [accountsRes, budgetsRes, presetsRes, settingsRes] = await Promise.all([
    supabase.from("accounts").select("id, name, balance").order("name", { ascending: true }),
    supabase
      .from("budgets")
      .select("id, category, monthly_limit, period, period_start, month, year")
      .order("period_start", { ascending: false }),
    supabase.from("quick_add_presets").select("id, name, category, subcategory, note").order("created_at", { ascending: false }),
    supabase.from("user_settings").select("id, default_account_id, currency").maybeSingle(),
  ]);

  return (
    <SettingsManager
      accounts={accountsRes.data ?? []}
      initialBudgets={budgetsRes.data ?? []}
      initialPresets={presetsRes.data ?? []}
      initialSettings={settingsRes.data ?? null}
    />
  );
}
