/**
 * lib/supabase/client.ts — browser-side Supabase client (`@supabase/ssr`).
 *
 * Use from Client Components ("use client") only. Server Components, Route
 * Handlers, and Server Actions must use `lib/supabase/server.ts` instead —
 * the two use different cookie-handling strategies and must not be mixed
 * (see the @supabase/ssr Next.js guide).
 *
 * Typed against `Database` (types/db.ts) so every `.from("smark_x")` call,
 * column, and `smark_role()` RPC is checked against plan/SCHEMA.md.
 *
 * Deliberately no barrel `lib/supabase/index.ts` re-exporting both this and
 * server.ts — that would risk a client bundle pulling in `next/headers`.
 * Import `@/lib/supabase/client` and `@/lib/supabase/server` explicitly.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/db";
import { getSupabasePublicEnv } from "./env";

/**
 * Creates a browser Supabase client. Cheap to call repeatedly — in a browser
 * runtime `@supabase/ssr` memoizes the underlying client per (url, key) pair
 * (`isSingleton` defaults to `true`), so calling this in a component body or
 * a hook on every render is safe and does not spawn duplicate auth listeners.
 */
export function createClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
