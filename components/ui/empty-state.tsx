import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateTone = "default" | "subtle";

const TONE_CLASSES: Record<EmptyStateTone, string> = {
  /** Dashed slate + panel fill — primary "nothing loaded yet" states (prototype: order/pick workspace). */
  default: "border-[1.5px] border-dashed border-slate bg-surface-panel py-12",
  /** Hairline dashed charcoal, no fill — quieter inline states (prototype: scan-tab idle). */
  subtle: "border border-dashed border-charcoal bg-transparent py-10",
};

export interface EmptyStateProps
  extends Omit<ComponentPropsWithRef<"div">, "title"> {
  tone?: EmptyStateTone;
  /** 44px icon slot, rendered in graphite. */
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Row of pill buttons (e.g. sample-data shortcuts), centered below the copy. */
  actions?: ReactNode;
}

/**
 * Dashed empty-state well (prototype: "Drop your filled template here",
 * "Point the camera at an ESD-plastic or Big-Box QR"). Border does the
 * work — no icon illustration beyond the optional 44px stroke icon.
 */
export function EmptyState({
  tone = "default",
  icon,
  title,
  description,
  actions,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-2xl px-6 text-center",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          aria-hidden
          className="mx-auto mb-4 size-11 text-graphite [&_svg]:size-full"
        >
          {icon}
        </div>
      )}
      {title != null && <div className="text-[17px] text-snow">{title}</div>}
      {description != null && (
        <div
          className={cn(
            "text-[15px] text-smoke",
            title != null && "mt-1.5",
            actions != null && "mb-6",
          )}
        >
          {description}
        </div>
      )}
      {children}
      {actions != null && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      )}
    </div>
  );
}
