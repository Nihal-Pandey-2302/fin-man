import { AccountsManager } from "@/components/accounts-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function AccountsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: false });

  return <AccountsManager initialAccounts={data ?? []} userId={user?.id ?? ""} />;
}
