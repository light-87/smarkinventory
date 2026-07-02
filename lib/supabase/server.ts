/**
 * lib/supabase/server.ts — server-side Supabase clients (`@supabase/ssr`).
 *
 * Two clients, two very different trust levels:
 *
 *  - `createClient()` — per-request, cookie-bound, RLS-enforced as the
 *    signed-in user. Use in Server Components, Route Handlers, and Server
 *    Actions. Always create a NEW one per request/render (never module-level
 *    cache it) and always `await` it — it reads the request's cookie jar.
 *
 *  - `createServiceClient()` — service-role key, RLS BYPASSED entirely. No
 *    cookies, no user session. Reserved for trusted server-only paths: the
 *    browser-worker's job queue claim (`smark_order_jobs` FOR UPDATE SKIP
 *    LOCKED), owner user-management actions (Settings → Users, which must
 *    create `auth.users` rows via the Auth admin API), cron/webhooks.
 *    NEVER import this into a Client Component and never let
 *    `SUPABASE_SERVICE_ROLE_KEY` reach the browser bundle. Every write made
 *    through this client must stamp the acting `smark_app_users.id` onto
 *    actor/created_by columns by hand — RLS isn't doing that bookkeeping.
 *
 * Typed against `Database` (types/db.ts), env-driven per FEATURES.md §3.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { getSupabasePublicEnv, requireEnv } from "./env";

/**
 * Per-request server client bound to the caller's session cookies.
 *
 * `setAll` is wrapped in try/catch: Server Components are allowed to READ
 * cookies but cannot WRITE them (only Route Handlers, Server Actions, and
 * middleware can) — Next.js throws if you try. When that happens here, the
 * session refresh is silently skipped; `lib/supabase/middleware.ts` is what
 * actually keeps sessions alive across Server Component renders.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — expected, see above.
        }
      },
    },
  });
}

/**
 * Service-role client — bypasses RLS entirely. See the module-level warning
 * above before reaching for this; `createClient()` is almost always right.
 */
export function createServiceClient() {
  const { url } = getSupabasePublicEnv();
  return createSupabaseClient<Database>(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
