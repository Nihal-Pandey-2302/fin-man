"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"signin" | "signup" | null>(
    null
  );

  const onSubmit = async (event: FormEvent, mode: "signin" | "signup") => {
    event.preventDefault();
    setError(null);
    setLoadingAction(mode);
    // #region agent log
    fetch("http://127.0.0.1:7507/ingest/84f0df0a-ab44-4404-9c1f-d1e8e11b9674", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd6d71" },
      body: JSON.stringify({
        sessionId: "fd6d71",
        runId: "pre-fix",
        hypothesisId: "H1_H3",
        location: "app/login/page.tsx:20",
        message: "onSubmit start",
        data: { mode, hasEmail: email.length > 0, passwordLength: password.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    const supabase = createSupabaseBrowserClient();
    // #region agent log
    fetch("http://127.0.0.1:7507/ingest/84f0df0a-ab44-4404-9c1f-d1e8e11b9674", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd6d71" },
      body: JSON.stringify({
        sessionId: "fd6d71",
        runId: "post-fix",
        hypothesisId: "H1",
        location: "app/login/page.tsx:32",
        message: "auth function references",
        data: {
          mode,
          detachedCall: false,
          signInFnType: typeof supabase.auth.signInWithPassword,
          signUpFnType: typeof supabase.auth.signUp,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    let authError: { message: string } | null = null;
    try {
      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      authError = result.error;
    } catch (caught) {
      // #region agent log
      fetch("http://127.0.0.1:7507/ingest/84f0df0a-ab44-4404-9c1f-d1e8e11b9674", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd6d71" },
        body: JSON.stringify({
          sessionId: "fd6d71",
          runId: "pre-fix",
          hypothesisId: "H1_H2",
          location: "app/login/page.tsx:57",
          message: "auth call threw",
          data: {
            mode,
            errorName:
              caught instanceof Error ? caught.name : "unknown",
            errorMessage:
              caught instanceof Error ? caught.message : String(caught),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw caught;
    }

    if (authError) {
      // #region agent log
      fetch("http://127.0.0.1:7507/ingest/84f0df0a-ab44-4404-9c1f-d1e8e11b9674", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd6d71" },
        body: JSON.stringify({
          sessionId: "fd6d71",
          runId: "pre-fix",
          hypothesisId: "H4",
          location: "app/login/page.tsx:75",
          message: "auth call returned error",
          data: { mode, authError: authError.message },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setError(authError.message);
      setLoadingAction(null);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-xl font-semibold">Sign in to Finance Terminal</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Email + password auth powered by Supabase.
        </p>

        <form className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="submit"
              onClick={(e) => void onSubmit(e, "signin")}
              disabled={loadingAction !== null}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {loadingAction === "signin" ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="submit"
              onClick={(e) => void onSubmit(e, "signup")}
              disabled={loadingAction !== null}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
            >
              {loadingAction === "signup" ? "Creating..." : "Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
