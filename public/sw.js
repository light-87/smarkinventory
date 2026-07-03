// public/sw.js — SmarkStock service worker.
//
// Deliberately conservative: cache-first for a small, static app-shell asset
// list only (icons, manifest, brand SVGs). Everything else (pages, RSC
// payloads, Supabase/API calls) is network-only — this app's data is live
// inventory/order state, and a stale cached page or API response would be
// actively wrong, not just ugly. Registered from
// components/shell/register-service-worker.tsx (root app/layout.tsx is
// integrator-locked, so registration can't live there).
//
// FEATURES.md §18 also wants an offline scan queue — that's the scan
// package's job (docs/OWNERSHIP.md: "Service-worker offline-queue logic
// (coordinates with auth-shell on SW registration)"). Extend this file with
// additional `fetch`/`sync` handling there; keep the cache-first block below
// scoped to static assets so it doesn't fight that queue.

const CACHE_NAME = "smarkstock-shell-v1";
const APP_SHELL_ASSETS = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/brand/smark-logo-on-dark-alt.svg",
  "/brand/smark-mark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS)).catch(() => {
      // A missing/renamed asset shouldn't block install — cache-first below
      // just falls through to network for anything not actually cached.
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return APP_SHELL_ASSETS.some((path) => url.pathname === path);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !isStaticAsset(url)) {
    return; // network-only (default browser behaviour) for everything else
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
