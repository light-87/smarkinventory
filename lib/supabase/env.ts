/**
 * lib/supabase/env.ts — shared env plumbing for the Supabase client factories.
 *
 * Internal to `lib/supabase/*` (client.ts / server.ts / middleware.ts import
 * this; feature packages should not need it directly). Centralized so a
 * missing key fails loudly with the same actionable message everywhere,
 * instead of three slightly-different ad hoc checks.
 */

/** Reads a required env var or throws with a message pointing at the fix. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — copy .env.local.example to .env.local and fill in your Supabase project keys (FEATURES.md §3).`,
    );
  }
  return value;
}

/** The two public keys every Supabase client (browser or server) needs. */
export function getSupabasePublicEnv(): {
  url: string;
  anonKey: string;
} {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}
