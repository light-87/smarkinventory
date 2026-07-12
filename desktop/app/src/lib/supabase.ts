import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (desktop/app/.env).");
}

// F-015 (docs/TESTING-FINDINGS.md): the CLI runner's short-lived
// persistSession:false client let the access token expire mid-session on a
// long supervised sourcing run. The desktop app instead stays signed in for
// as long as it's open — autoRefreshToken keeps the token alive in the
// background, persistSession (webview localStorage) survives app restarts.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
