/**
 * lib/portal/anon-client.ts — a bare anon-key Supabase client, portal-only.
 *
 * Deliberately NOT `lib/supabase/server.ts`'s `createClient()`: that one is
 * cookie-bound and forwards whatever session cookie exists in the visitor's
 * browser. A staff member logged into the internal app who then opens a
 * `/p/:token` link in the SAME browser would otherwise hit these RPCs as
 * `authenticated`, not `anon` — and 0006's migration grants EXECUTE on the
 * portal functions to `anon` ONLY (FEATURES.md §11 — "reads ONLY via
 * security-definer functions"; the mission brief: "the anon client must
 * never touch base tables" — read here as "the portal is unconditionally
 * anonymous, full stop"). That mismatch would surface as a confusing
 * "permission denied" for staff instead of the public flow working the same
 * for absolutely everyone. This factory never reads cookies and never
 * persists a session, so every request into `/p/**` behaves identically
 * regardless of who's holding the browser.
 *
 * Untyped (no `Database` generic) on purpose: this client only ever calls
 * `.rpc()` against the three functions in
 * `supabase/migrations/0006_portal_fns.sql`, which are not part of the
 * shared `types/db.ts` contract (integrator-owned — docs/OWNERSHIP.md; this
 * package cannot add to it). Callers validate the returned jsonb shape with
 * the zod schemas in `lib/portal/types.ts` instead of relying on generated
 * table types.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export function createPortalAnonClient(): SupabaseClient {
  const { url, anonKey } = getSupabasePublicEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
