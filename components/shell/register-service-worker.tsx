"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` (CLAUDE.md PWA checklist: "service worker
 * registered"). Mounted once from the login page and once from the authed
 * AppShell, since `app/layout.tsx` (the one place that wraps every route) is
 * integrator-locked. Idempotent — `serviceWorker.register()` is a no-op if
 * the same script URL is already registered.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — the app works fully online without it.
    });
  }, []);

  return null;
}
