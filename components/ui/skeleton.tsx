import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Material-style shimmer skeleton block, single dark theme (SmarkStock's
 * palette is a locked dark system — app/globals.css — no light-mode variant
 * to account for). Built on `--animate-shimmer`/`@keyframes smk-shimmer`,
 * which app/globals.css already defined but never wired up to a component.
 *
 * Used by every heavy route's `loading.tsx` to build a skeleton that mirrors
 * that page's real layout (App Router renders these instantly on navigation
 * while the real server component streams in behind it).
 */
export function Skeleton({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-[length:200%_100%] bg-gradient-to-r from-surface-raised via-ash to-surface-raised",
        className,
      )}
      {...props}
    />
  );
}

/** A single skeleton table/list row: fixed-height bar, optional leading icon slot. */
export function SkeletonRow({ className, withIcon = false }: { className?: string; withIcon?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 px-5 py-3.5", className)}>
      {withIcon && <Skeleton className="size-8 flex-none rounded-full" />}
      <Skeleton className="h-3.5 flex-1 rounded" />
      <Skeleton className="h-3.5 w-16 flex-none rounded" />
      <Skeleton className="h-3.5 w-20 flex-none rounded" />
    </div>
  );
}

/** A stat-tile placeholder (dashboard-style stat grid). */
export function SkeletonStatCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-charcoal bg-surface-panel px-5 py-4", className)}>
      <Skeleton className="mb-3 h-3 w-20 rounded" />
      <Skeleton className="h-6 w-24 rounded" />
    </div>
  );
}

/** A Card-shaped placeholder with an optional header bar. */
export function SkeletonCard({ className, header = true }: { className?: string; header?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-charcoal bg-surface", className)}>
      {header && (
        <div className="flex items-center justify-between border-b border-border-divider px-5 py-4">
          <Skeleton className="h-3.5 w-32 rounded" />
          <Skeleton className="h-3 w-12 rounded" />
        </div>
      )}
      <div className="space-y-3 px-5 py-[18px]">
        <Skeleton className="h-3.5 w-full rounded" />
        <Skeleton className="h-3.5 w-5/6 rounded" />
        <Skeleton className="h-3.5 w-2/3 rounded" />
      </div>
    </div>
  );
}
