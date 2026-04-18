import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // #region agent log
  fetch("http://127.0.0.1:7507/ingest/84f0df0a-ab44-4404-9c1f-d1e8e11b9674", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd6d71" },
    body: JSON.stringify({
      sessionId: "fd6d71",
      runId: "pre-fix",
      hypothesisId: "H2_H4",
      location: "lib/supabase-browser.ts:8",
      message: "createSupabaseBrowserClient environment/context",
      data: {
        hasUrl: Boolean(supabaseUrl),
        hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        hasPublishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
        hasWindow: typeof window !== "undefined",
        hasLocalStorage: typeof window !== "undefined" && Boolean(window.localStorage),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }

  const client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  // #region agent log
  fetch("http://127.0.0.1:7507/ingest/84f0df0a-ab44-4404-9c1f-d1e8e11b9674", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd6d71" },
    body: JSON.stringify({
      sessionId: "fd6d71",
      runId: "pre-fix",
      hypothesisId: "H2_H4",
      location: "lib/supabase-browser.ts:36",
      message: "createBrowserClient returned client",
      data: {
        hasAuth: Boolean((client as { auth?: unknown }).auth),
        hasSignUp:
          typeof (client as { auth?: { signUp?: unknown } }).auth?.signUp === "function",
        hasSignIn:
          typeof (client as { auth?: { signInWithPassword?: unknown } }).auth
            ?.signInWithPassword === "function",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return client;
}
