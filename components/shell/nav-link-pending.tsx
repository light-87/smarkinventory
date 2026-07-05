"use client";

import { useEffect, useId } from "react";
import { useLinkStatus } from "next/link";
import { useNavigationProgress } from "./navigation-progress";

/**
 * Render as a child of every shell `<Link>` (Rail / BottomBar / MoreSheet —
 * `useLinkStatus` only works inside a descendant of the `<Link>` it tracks).
 *
 * Two jobs:
 *  1. Always mirrors this one link's pending state into
 *     `NavigationProgressProvider` so `<TopProgressBar>` lights up the
 *     instant ANY nav item is clicked, not just this one.
 *  2. Optionally (`spinner`) renders a tiny inline spinner next to *this*
 *     link while it's the one being navigated to — instant per-tab "something's
 *     happening" feedback where there's room for it (desktop rail); the
 *     compact bottom bar / More sheet pass `spinner={false}` and rely on the
 *     top bar alone to avoid layout jitter in a 60px-tall nav.
 */
export function NavLinkPending({ spinner = false }: { spinner?: boolean }) {
  const { pending } = useLinkStatus();
  const { reportPending } = useNavigationProgress();
  const id = useId();

  useEffect(() => {
    reportPending(id, pending);
    return () => reportPending(id, false);
  }, [pending, id, reportPending]);

  if (!spinner || !pending) return null;

  return (
    <span
      aria-hidden
      className="ml-auto size-3 flex-none animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}
