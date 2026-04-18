"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function SignOutButton() {
  const router = useRouter();

  const onSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onSignOut}
      className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
    >
      Sign out
    </button>
  );
}
