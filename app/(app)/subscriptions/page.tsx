import { SubscriptionsManager, type Subscription } from "@/components/subscriptions-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function SubscriptionsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name")
    .order("created_at", { ascending: false });

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("id, name, amount, billing_cycle, next_due_date, account_id, category, auto_insert, is_active")
    .order("next_due_date", { ascending: true });

  return (
    <SubscriptionsManager
      accounts={accounts ?? []}
      initialItems={(subscriptions ?? []) as Subscription[]}
    />
  );
}
