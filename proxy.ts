import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase-middleware";

const PUBLIC_ROUTES = ["/login"];

// 🔓 Files that must NEVER go through auth
const PUBLIC_FILES = [
  "/manifest.json",
  "/sw.js",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ 1. Skip middleware for static / PWA / Next internals
  if (
    pathname.startsWith("/_next") ||        // Next.js internals
    pathname.startsWith("/icons") ||        // PWA icons
    pathname.startsWith("/favicon") ||      // favicon
    pathname.startsWith("/manifest") ||     // manifest.json
    pathname.startsWith("/sw.js") ||        // service worker
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/) // static assets
  ) {
    return NextResponse.next();
  }

  // ✅ 2. Supabase client
  const { supabase, response } = createSupabaseMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    pathname.startsWith(route)
  );

  // 🔒 3. Protect routes
  if (!user && !isPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  // 🔁 4. Redirect logged-in users away from login
  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

// ✅ 5. Matcher (still important, but now safer)
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};