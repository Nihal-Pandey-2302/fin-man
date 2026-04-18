import { EarningsManager } from "@/components/earnings-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function EarningsPage() {
  const supabase = await createSupabaseServerClient();
  const [accountsRes, incomeRes, settingsRes] = await Promise.all([
    supabase.from("accounts").select("id, name").order("name", { ascending: true }),
    supabase
      .from("income_entries")
      .select("id, source_name, source_type, amount, date, account_id, note")
      .order("date", { ascending: false }),
    supabase.from("user_settings").select("liquid_buffer").maybeSingle(),
  ]);

  // Keep page resilient even if migration hasn't been applied yet.
  const safeBuffer = settingsRes.error ? 0 : Number(settingsRes.data?.liquid_buffer ?? 0);

  return (
    <EarningsManager
      accounts={(accountsRes.data ?? []) as { id: string; name: string }[]}
      initialItems={
        (incomeRes.data ?? []) as Array<{
          id: string;
          source_name: string;
          source_type: string;
          amount: number;
          date: string;
          account_id: string | null;
          note: string | null;
        }>
      }
      initialBuffer={safeBuffer}
    />
  );
}
