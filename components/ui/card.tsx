import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardTone =
  | "surface" /* white card — the default                                    */
  | "panel" /* quieter inline panel                                          */
  | "neutral" /* white + a grey left rail — "nothing special" but aligned    */
  | "accent" /* cobalt-tinted pod — info / needs review                      */
  | "success" /* green-tinted pod — done / in stock / approved               */
  | "warn" /* amber-tinted pod — caution / low / pending                     */
  | "danger"; /* red-tinted pod — out / overdue / error                      */

export interface CardProps extends ComponentPropsWithRef<"div"> {
  /** Semantic surface. State tones (accent/success/warn/danger/neutral) add a
   *  tinted "pod" fill + a 4px left accent bar so a card's meaning reads at a
   *  glance. Plain white/panel stay neutral — most cards. */
  tone?: CardTone;
  /** none when composing with CardHeader/CardBody; md ≈ prototype 18–20px */
  padding?: "none" | "md" | "lg";
  /** Hover affordance for clickable cards (border lifts, surface warms). */
  interactive?: boolean;
}

/** bg + border (incl. the 4px left accent bar for state tones). */
const CARD_TONE: Record<CardTone, string> = {
  surface: "bg-surface border-charcoal",
  panel: "bg-surface-panel border-charcoal",
  neutral: "bg-surface border-charcoal border-l-4 border-l-slate",
  accent: "bg-surface-accent border-charcoal border-l-4 border-l-smark-orange",
  success: "bg-surface-success border-charcoal border-l-4 border-l-phosphor-green",
  warn: "bg-surface-warn border-charcoal border-l-4 border-l-warn",
  danger: "bg-surface-danger border-charcoal border-l-4 border-l-smark-orange-soft",
};

/**
 * Card — elevation by border, never shadow. `tone` carries meaning: a plain
 * white surface for the ~70% that's just content, or a tinted state pod
 * (accent/success/warn/danger) for the cards that need to signal something.
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
        "rounded-2xl border",
        CARD_TONE[tone],
        padding === "md" && "px-5 py-[18px]",
        padding === "lg" && "p-6",
        interactive && "cursor-pointer transition-colors hover:border-graphite",
        // Warm the bg on hover only for plain white cards — on a tinted pod it
        // would flatten the state colour.
        interactive && tone === "surface" && "hover:bg-surface-hover",
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
        <span className="truncate text-[17px] font-medium text-snow">
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
        "text-[13px] tracking-[0.06em] text-smoke uppercase",
        className,
      )}
      {...props}
    />
  );
}
