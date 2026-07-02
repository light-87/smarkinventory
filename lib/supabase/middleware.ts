/**
 * lib/supabase/middleware.ts — session-refresh helper for Next.js middleware.
 *
 * `@supabase/ssr` auth tokens are short-lived and refreshed on read; if
 * nothing ever writes the refreshed cookies back to the browser, sessions
 * appear to randomly log out mid-shift (bad — FEATURES §2 promises sessions
 * "persist per device; manual logout"). The fix is a root `middleware.ts`
 * that runs this on every request.
 *
 * This file only exports the helper — the shell/auth package owns the
 * actual root `middleware.ts` (route matcher, redirect-to-login logic for
 * protected paths, etc.) and should call it like:
 *
 * ```ts
 * // middleware.ts
 * import { updateSession } from "@/lib/supabase/middleware";
 * export async function middleware(request: NextRequest) {
 *   const { response } = await updateSession(request);
 *   return response; // or branch on supabase.auth.getUser() first
 * }
 * export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
 * ```
 *
 * Pattern: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/db";
import { getSupabasePublicEnv } from "./env";

export interface UpdateSessionResult {
  /** Return this from middleware (or continue building on top of it) so refreshed auth cookies reach the browser. */
  response: NextResponse;
  /** The request-scoped client — reuse it if middleware also needs the user (avoids a second round trip). */
  supabase: ReturnType<typeof createServerClient<Database>>;
}

export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: do not remove. This is what actually triggers a token
  // refresh (and therefore the `setAll` above) — `getUser()` re-validates
  // against Supabase Auth rather than trusting the cookie's claims, which is
  // also why middleware should read the user from here rather than decode
  // the session cookie itself.
  await supabase.auth.getUser();

  return { response, supabase };
}
