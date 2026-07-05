"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface NavigationProgressContextValue {
  /** True while at least one tracked nav link is mid-navigation. */
  pending: boolean;
  /** Reporters (nav-link-pending.tsx) register/unregister their own pending state by a stable id. */
  reportPending: (id: string, isPending: boolean) => void;
}

const NavigationProgressContext = createContext<NavigationProgressContextValue | null>(null);

/**
 * Shared "is a route navigation in flight" flag for the whole shell.
 *
 * There's no router-level "navigation started" event in the App Router, so
 * this is fed by `NavLinkPending` (rendered as a child of every shell
 * `<Link>`) calling `useLinkStatus()` on itself and mirroring that one
 * link's pending state in here — a documented pattern for `useLinkStatus`
 * (Next 15.3+/16). Multiple links can theoretically be "pending" at once
 * (e.g. a fast double click), so this tracks a *set* of pending ids rather
 * than a single boolean.
 */
export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const pendingIds = useRef(new Set<string>());
  const [pending, setPending] = useState(false);

  const reportPending = useCallback((id: string, isPending: boolean) => {
    const ids = pendingIds.current;
    if (isPending) ids.add(id);
    else ids.delete(id);
    setPending(ids.size > 0);
  }, []);

  return (
    <NavigationProgressContext.Provider value={{ pending, reportPending }}>
      {children}
    </NavigationProgressContext.Provider>
  );
}

export function useNavigationProgress(): NavigationProgressContextValue {
  const ctx = useContext(NavigationProgressContext);
  if (!ctx) {
    throw new Error("useNavigationProgress must be used within a NavigationProgressProvider");
  }
  return ctx;
}
