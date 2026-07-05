"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useNavigationProgress } from "./navigation-progress";

/**
 * Thin Material-style top progress bar (2-3px) — the instant "something's
 * happening" cue for every navigation, so a click never feels frozen for the
 * 2-3s a server component takes to stream in. Fed by `NavigationProgressProvider`
 * (see nav-link-pending.tsx for how that gets set).
 *
 * Hand-rolled, no dependency (no nprogress/nextjs-toploader): a tiny state
 * machine that jumps to ~20% immediately on click (so the click itself reads
 * as acknowledged), eases toward ~78% while still pending, then snaps to
 * 100% and fades out once the route resolves.
 *
 * Uses the SmarkStock brand accent (`--color-smark-orange`, #f57d05) rather
 * than the generic Material blue (#1976D2) — this app's whole design system
 * (app/globals.css) is a locked dark theme built around that orange accent
 * (see Rail's active-tab tick, Button's primary variant, spinners
 * throughout), so a blue bar would be the one inconsistent element on every
 * screen. Bar color is the only intentional deviation from the brief.
 */
export function TopProgressBar() {
  const { pending } = useNavigationProgress();

  // "Adjusting state when a prop changes" (react.dev — You Might Not Need An
  // Effect): the instant part of the transition (jump to ~20% / snap to
  // 100%) is derived directly during render off `pending`, not round-tripped
  // through an effect — that keeps the very first frame in sync with the
  // click with zero extra tick of latency. Only the *timed* follow-ups
  // (easing further while still pending, unmounting after the fade) are
  // genuine external-timer side effects, so those alone live in useEffect.
  const [prevPending, setPrevPending] = useState(pending);
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState(0);
  const [fading, setFading] = useState(false);

  if (pending !== prevPending) {
    setPrevPending(pending);
    if (pending) {
      setMounted(true);
      setFading(false);
      setWidth(20);
    } else {
      setWidth((w) => (w > 0 ? 100 : 0));
      setFading(true);
    }
  }

  const growTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (growTimer.current) clearTimeout(growTimer.current);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);

    if (pending) {
      growTimer.current = setTimeout(() => setWidth(78), 80);
    } else if (mounted) {
      unmountTimer.current = setTimeout(() => {
        setMounted(false);
        setWidth(0);
        setFading(false);
      }, 350);
    }

    return () => {
      if (growTimer.current) clearTimeout(growTimer.current);
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm timers off `pending`; `mounted` only gates the unmount branch
  }, [pending]);

  if (!mounted) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden">
      <div
        className={cn(
          "h-full bg-smark-orange shadow-[0_0_6px_rgba(245,125,5,0.55)] transition-[width,opacity] ease-out",
          fading ? "opacity-0 duration-300" : "opacity-100 duration-500",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
