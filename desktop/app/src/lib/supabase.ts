import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (desktop/app/.env).");
}

// F-017 (docs/TESTING-FINDINGS.md): on Krunal's machines the app "always logs
// out". Root cause — persistSession defaulted to the WebView2 localStorage,
// which lives inside the WebView2 data folder that Windows AV / OneDrive wipe
// between launches; once cleared, the ~1h access token can't be refreshed and
// the user is signed out. This adapter persists the session to a JSON file in
// the app's own data directory (via the Rust auth_store_* commands), OUTSIDE
// that volatile folder, so sign-in is genuinely one-time and survives restarts.
// All three methods are async; supabase-js reads the session through the async
// getSession() path (see App.tsx), so nothing assumes synchronous storage.
const durableStorage: SupportedStorage = {
  getItem: (key) => invoke<string | null>("auth_store_get", { key }),
  setItem: (key, value) => invoke<void>("auth_store_set", { key, value }),
  removeItem: (key) => invoke<void>("auth_store_remove", { key }),
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: durableStorage,
    storageKey: "smarkstock-desktop-auth",
    persistSession: true,
    autoRefreshToken: true,
  },
});
