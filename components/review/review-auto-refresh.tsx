"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The Order Review page is a server render (getReviewData). While a desktop run
 * is live it keeps POSTing new results to the DB, but the open page wouldn't
 * show them without a manual reload. This mounts an interval that re-runs the
 * server component via router.refresh() (~5s, only while the tab is visible),
 * so synced results appear on their own. router.refresh() reconciles without
 * wiping the cards' local radio/qty state. No SSE needed — the review's
 * freshness lives entirely in the server query.
 */
export function ReviewAutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer != null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up immediately on focus
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [router, intervalMs]);

  return null;
}
