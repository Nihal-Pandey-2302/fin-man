import { InvestmentsManager, type Investment } from "@/components/investments-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function InvestmentsPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: accounts }] = await Promise.all([
    supabase
      .from("investments")
      .select(
        "id, name, type, platform, amount_invested, current_value, date, is_sip, sip_amount, sip_date, account_id, sip_last_posted_month, note"
      )
      .order("date", { ascending: false }),
    supabase.from("accounts").select("id, name").order("name", { ascending: true }),
  ]);

  return (
    <InvestmentsManager
      accounts={(accounts ?? []) as { id: string; name: string }[]}
      initialItems={(data ?? []) as Investment[]}
    />
  );
}
