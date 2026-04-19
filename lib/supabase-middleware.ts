import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase-middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createSupabaseMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Auth redirect
  if (!user && !request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // ✅ Set autopay_last_run cookie here — middleware CAN write cookies
  if (user) {
    const today = new Date().toISOString().slice(0, 10);
    const lastRun =
      request.cookies.get("autopay_last_run")?.value ??
      response.cookies.get("autopay_last_run")?.value;

    if (lastRun !== today) {
      response.cookies.set("autopay_last_run", today, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24, // 24 hours
      });
      // Flag so layout.tsx knows to run the engine
      response.cookies.set("autopay_should_run", "true", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60, // short-lived, just for this request cycle
      });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};