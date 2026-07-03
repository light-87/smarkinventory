import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * proxy.ts (repo root) — auth-shell owns this file (docs/OWNERSHIP.md).
 * Renamed from `middleware.ts` per Next.js 16's file-convention rename
 * (the `middleware` export/file name is deprecated in favor of `proxy` —
 * https://nextjs.org/docs/messages/middleware-to-proxy). Behavior is
 * unchanged; only the file name and exported function name moved.
 *
 * Two jobs:
 *  1. `updateSession()` refreshes the Supabase auth cookies on every request
 *     (see lib/supabase/middleware.ts — without this, sessions randomly
 *     expire mid-shift instead of "persisting per device" per FEATURES §2).
 *  2. Route guard: unauthenticated (or deactivated — `smark_role()` is NULL
 *     for both) → redirect to /login; an authenticated, active user hitting
 *     /login bounces straight to /dashboard.
 *
 * `/p/**` (client portal, FEATURES §17) is a public surface — excluded from
 * the gate even though it doesn't exist yet, so the portal package doesn't
 * need a proxy change later. `/api/**` gets its cookies refreshed but
 * skips the redirect (route handlers answer with their own JSON/status, not
 * a 302 to an HTML login page).
 */
const PUBLIC_PREFIXES = ["/login", "/p"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { response, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api")) return response;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // smark_role() is the same RLS helper every policy uses — NULL for anon,
  // unknown, AND deactivated accounts (lib/auth/roles.ts accessFor mirrors
  // this null-is-denied contract on the app side).
  let active = false;
  if (user) {
    const { data: role } = await supabase.rpc("smark_role");
    active = role != null;
  }

  if (!active && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (active && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|manifest.json|sw.js|icons|brand).*)",
  ],
};
