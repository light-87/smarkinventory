"use client";

/**
 * hooks/use-agent-runs-feed.ts — client-side "live-ish" refresh for the
 * Dashboard's agent-activity card (components/dashboard/agent-activity-card.tsx,
 * plan/tab-dashboard.md). docs/OWNERSHIP.md's `dashboard` package owns this —
 * not listed under a specific hook name there, so it follows the sibling
 * `search-notifications` package's precedent instead
 * (hooks/use-notifications.ts): **polling, not Realtime**, reading directly
 * through the caller's own RLS session via `lib/supabase/client.ts` (never
 * service-role — HARD RULES: "RLS clients in app routes").
 *
 * One deliberate difference from that precedent: this only polls **while at
 * least one fetched run is still `planning`/`running`** — a page with zero
 * active runs has nothing left to refresh, so it stays fully static (no
 * wasted requests, no interval ever created). The moment the last active run
 * finishes, the effect's dependency (`hasActiveRuns`, a primitive boolean)
 * flips and the interval is torn down.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getRecentAgentRuns, type AgentRunFeedRow } from "@/lib/dashboard/queries";
import { isRunActive } from "@/lib/dashboard/compute";

const POLL_INTERVAL_MS = 8_000;

/**
 * Seeds from the server-rendered `initialRuns` (no loading flash on mount),
 * then polls only while a run is active. `limit` must match whatever the
 * server fetch used, or the feed's window size will visibly jump on refresh.
 */
export function useAgentRunsFeed(initialRuns: AgentRunFeedRow[], limit = 5): AgentRunFeedRow[] {
  const [runs, setRuns] = useState(initialRuns);
  const mountedRef = useRef(true);

  // A fresh server render (e.g. client-side navigation back to /dashboard)
  // should win over whatever the last poll tick left client state at. Adjusted
  // during render (React's documented pattern for "reset state when a prop
  // changes") rather than in an effect, so it never triggers the extra
  // cascading render a `useEffect(() => setRuns(...), [initialRuns])` would.
  const [prevInitialRuns, setPrevInitialRuns] = useState(initialRuns);
  if (initialRuns !== prevInitialRuns) {
    setPrevInitialRuns(initialRuns);
    setRuns(initialRuns);
  }

  const refresh = useCallback(async () => {
    const supabase = createClient();
    try {
      const next = await getRecentAgentRuns(supabase, limit);
      if (mountedRef.current) setRuns(next);
    } catch {
      // Best-effort — keep showing the last good snapshot on a transient error.
    }
  }, [limit]);

  const hasActiveRuns = runs.some((r) => isRunActive(r.status));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hasActiveRuns) return;
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasActiveRuns, refresh]);

  return runs;
}
