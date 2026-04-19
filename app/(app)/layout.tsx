import { cookies } from "next/headers";
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

  // ✅ Only run engine if middleware flagged it
  const cookieStore = await cookies();
  const shouldRun = cookieStore.get("autopay_should_run")?.value === "true";

  let autopayResult = { firedCount: 0, toastMessages: [] as string[] };

  if (shouldRun) {
    autopayResult = await runAutopayEngineForCurrentUser(supabase, user.id);
  }

  return (
    <AppShell initialToastMessages={autopayResult.toastMessages}>
      {children}
    </AppShell>
  );
}