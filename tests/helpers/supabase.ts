import { describe } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Test-harness access to the LOCAL Supabase stack (bunx supabase start).
 *
 * Integration/RLS suites (tests/integration, DB-backed invariants) must:
 *   - build clients through these factories only (never hardcode keys), and
 *   - gate themselves on `hasLocalSupabase` via `describeWithDb` so plain
 *     `bun test` stays green on machines/jobs without the local stack.
 *
 * CI exports these variables from `supabase status -o env` after
 * `supabase db reset` (see .github/workflows/ci.yml, integration job).
 */

const url =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True when a local Supabase stack is reachable via env (CI or dev). */
export const hasLocalSupabase = url.length > 0 && anonKey.length > 0;

/**
 * `describeWithDb(...)` = `describe` when the local stack is configured,
 * `describe.skip` otherwise — DB-backed suites stay green without Docker.
 * (CI's integration job always has the stack, so nothing silently skips there.)
 */
export const describeWithDb = hasLocalSupabase ? describe : describe.skip;

/** Anonymous client — the client-portal / logged-out surface. */
export function createAnonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client — seeding/assertions only, NEVER for RLS assertions. */
export function createServiceClient(): SupabaseClient {
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — run `bunx supabase start` and export its keys (see docs/DEV.md).",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Role-scoped client for the RLS matrix (FEATURES.md §2 / SCHEMA.md RLS FINAL).
 * Usernames map to synthetic emails `{username}@smark.internal` [R2-01].
 * Seeded test users (owner/employee/accountant) land with the supabase package;
 * suites should fail loudly if sign-in fails rather than silently passing.
 */
export async function createRoleClient(
  username: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({
    email: `${username}@smark.internal`,
    password,
  });
  if (error) {
    throw new Error(`test sign-in failed for "${username}": ${error.message}`);
  }
  return client;
}
