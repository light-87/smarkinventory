/**
 * lib/supabase/env.ts — shared env plumbing for the Supabase client factories.
 *
 * Internal to `lib/supabase/*` (client.ts / server.ts / middleware.ts import
 * this; feature packages should not need it directly). Centralized so a
 * missing key fails loudly with the same actionable message everywhere,
 * instead of three slightly-different ad hoc checks.
 */

function missingEnvError(name: string): Error {
  return new Error(
    `${name} is not set — copy .env.local.example to .env.local and fill in your Supabase project keys (FEATURES.md §3).`,
  );
}

/** Reads a required env var or throws with a message pointing at the fix. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw missingEnvError(name);
  }
  return value;
}

/**
 * The two public keys every Supabase client (browser or server) needs.
 *
 * These MUST be read as literal `process.env.NEXT_PUBLIC_X` member
 * expressions, not via `requireEnv(name)`'s dynamic `process.env[name]`
 * bracket lookup. Next.js's client-bundle env inlining (webpack and
 * Turbopack alike) is a textual find/replace keyed on that exact syntactic
 * pattern — it can only bake in variables it can see written out literally
 * in the source, not ones resolved through a computed property name at
 * runtime. Going through the dynamic helper here silently defeats that: in
 * the browser bundle `process.env` ends up with nothing useful inlined into
 * it, so every browser Supabase client throws "NEXT_PUBLIC_SUPABASE_URL is
 * not set" even with a correctly-filled `.env.local` (server-side code is
 * unaffected — there `process.env` is the real Node process object, dynamic
 * access and all).
 */
export function getSupabasePublicEnv(): {
  url: string;
  anonKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw missingEnvError("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!anonKey) {
    throw missingEnvError("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return { url, anonKey };
}
