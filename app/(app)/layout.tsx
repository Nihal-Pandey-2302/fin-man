import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { runAutopayEngineForCurrentUser } from "@/lib/autopay-engine";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const autopayResult = await runAutopayEngineForCurrentUser(supabase);

  return <AppShell initialToastMessages={autopayResult.toastMessages}>{children}</AppShell>;
}
