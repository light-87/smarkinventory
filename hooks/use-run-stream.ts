"use client";

/**
 * hooks/use-run-stream.ts — client-side consumer of
 * app/api/runs/[runId]/stream's SSE feed (plan/tab-agent-run.md — "live
 * comparison-row streaming"). Feeds the Agent Run console's sourcing lanes.
 *
 * Starts from `initialSnapshot` (the server-rendered read, so the console
 * never flashes empty on first paint) and only opens a connection if that
 * snapshot isn't already terminal — a run that's already `review`/`done`/
 * `failed` by the time the page loads has nothing left to stream.
 */

import { useEffect, useRef, useState } from "react";
import type { RunStreamSnapshot } from "@/lib/runs/types";

const TERMINAL_STATUSES = new Set(["review", "done", "failed"]);

export interface UseRunStreamResult {
  snapshot: RunStreamSnapshot | null;
  /** True once the SSE connection has opened at least once. */
  connected: boolean;
  /**
   * Set on either a transient `stream-warning` (a mid-poll read hiccup —
   * connection stays open, cleared by the next successful snapshot) or a
   * fatal `stream-error` (the run vanished — connection closes). Transport-
   * level connection issues are silent instead (EventSource auto-retries).
   */
  error: string | null;
  /** True once the run has reached a terminal status — the console should offer "Review results →". */
  isTerminal: boolean;
}

export function useRunStream(runId: string, initialSnapshot: RunStreamSnapshot | null): UseRunStreamResult {
  const [snapshot, setSnapshot] = useState<RunStreamSnapshot | null>(initialSnapshot);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTerminal = snapshot != null && TERMINAL_STATUSES.has(snapshot.status);
  const initialWasTerminal = useRef(initialSnapshot != null && TERMINAL_STATUSES.has(initialSnapshot.status));

  useEffect(() => {
    if (initialWasTerminal.current) return; // already settled server-side — nothing to stream

    const source = new EventSource(`/api/runs/${runId}/stream`);

    const handleOpen = () => setConnected(true);
    const handleSnapshot = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as RunStreamSnapshot;
      setSnapshot(data);
      setError(null);
      if (TERMINAL_STATUSES.has(data.status)) source.close();
    };
    function parseMessage(event: MessageEvent): string {
      try {
        const parsed = JSON.parse(event.data) as { message?: string };
        return parsed.message ?? "Lost the live connection to this run.";
      } catch {
        return "Lost the live connection to this run.";
      }
    }
    // Transient — a DB hiccup mid-poll while the run is still progressing
    // server-side. Surfaces the message but deliberately does NOT close the
    // connection: the server keeps polling and the next `snapshot` recovers
    // it (report finding #10 — this used to be indistinguishable from the
    // fatal case below, so a single transient hiccup permanently killed live
    // updates until a manual refresh).
    const handleStreamWarning = (event: MessageEvent) => setError(parseMessage(event));
    // Fatal — the run itself is gone; the server closed its side too, so
    // close ours in lockstep.
    const handleStreamError = (event: MessageEvent) => {
      setError(parseMessage(event));
      source.close();
    };
    // Native EventSource "error" fires for transport-level issues (the
    // browser retries automatically) — distinct from our own named
    // "stream-error"/"stream-warning" events above, which are server-side
    // application signals.
    const handleConnectionError = () => setConnected(false);

    source.addEventListener("open", handleOpen);
    source.addEventListener("snapshot", handleSnapshot);
    source.addEventListener("stream-warning", handleStreamWarning);
    source.addEventListener("stream-error", handleStreamError);
    source.addEventListener("error", handleConnectionError);

    return () => {
      source.close();
    };
  }, [runId]);

  return { snapshot, connected, error, isTerminal };
}
