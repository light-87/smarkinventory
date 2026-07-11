import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends ComponentPropsWithRef<"div"> {
  /** surface = #141414 card · panel = quieter #131313 inline panel */
  tone?: "surface" | "panel";
  /** none when composing with CardHeader/CardBody; md ≈ prototype 18–20px */
  padding?: "none" | "md" | "lg";
  /** Hover affordance for clickable cards (border lifts, surface warms). */
  interactive?: boolean;
}

/**
 * Card (prototype: #141414 surface, 1px #2e2e2e border, 16px radius —
 * elevation by border, never shadow).
 */
export function Card({
  tone = "surface",
  padding = "md",
  interactive = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-charcoal",
        tone === "surface" ? "bg-surface" : "bg-surface-panel",
        padding === "md" && "px-5 py-[18px]",
        padding === "lg" && "p-6",
        interactive &&
          "cursor-pointer transition-colors hover:border-graphite hover:bg-surface-hover",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps
  extends Omit<ComponentPropsWithRef<"div">, "title"> {
  /** Title, 15px medium snow (prototype card headers). */
  title?: ReactNode;
  /** Right-aligned meta slot, 12px smoke (e.g. "today"). */
  meta?: ReactNode;
}

/** Use inside `<Card padding="none">`. */
export function CardHeader({
  title,
  meta,
  className,
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border-divider px-5 py-4",
        className,
      )}
      {...props}
    >
      {title !== undefined && (
        <span className="truncate text-[16px] font-medium text-snow">
          {title}
        </span>
      )}
      {children}
      {meta !== undefined && (
        <span className="flex-none text-caption text-smoke">{meta}</span>
      )}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return <div className={cn("px-5 py-[18px]", className)} {...props} />;
}

/** Section label inside cards/drawers: 11px uppercase smoke. */
export function SectionLabel({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "text-[12px] tracking-[0.06em] text-smoke uppercase",
        className,
      )}
      {...props}
    />
  );
}
