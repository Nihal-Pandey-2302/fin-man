import { InvestmentsManager, type Investment } from "@/components/investments-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function InvestmentsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("investments")
    .select(
      "id, name, type, platform, amount_invested, current_value, date, is_sip, sip_amount, sip_date, note"
    )
    .order("date", { ascending: false });

  return <InvestmentsManager initialItems={(data ?? []) as Investment[]} />;
}
