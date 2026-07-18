import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

export type ChipTone =
  | "default" /* charcoal border · smoke text — locations, quiet meta   */
  | "neutral" /* charcoal border · silver text — counts, mid emphasis   */
  | "bright" /* charcoal border · snow text — emphasized values         */
  | "accent" /* cobalt tint — interactive / info emphasis               */
  | "warn" /* amber tint — caution: low stock, contested, offline       */
  | "success" /* green tint — in-stock / passed                         */
  | "danger" /* red tint — out of stock / error                         */
  | "soft"; /* ash fill + slate border — active filter chips            */

export type ChipSize = "sm" | "md";

/**
 * Status tones now carry a matching tinted FILL (surface-accent/warn/success/
 * danger), not just a hairline border+text — so a chip's colour reads at a
 * glance instead of whispering. The non-status tones (default/neutral/bright)
 * stay hairline so meta chips don't compete with real status.
 */
const TONE_CLASSES: Record<ChipTone, string> = {
  default: "border-charcoal text-smoke",
  neutral: "border-charcoal text-silver-mist",
  bright: "border-charcoal text-snow",
  accent: "border-smark-orange bg-surface-accent text-smark-orange",
  warn: "border-warn bg-surface-warn text-warn",
  success: "border-forest-depth bg-surface-success text-phosphor-green",
  danger: "border-smark-orange-soft bg-surface-danger text-smark-orange-soft",
  soft: "border-slate bg-ash text-snow",
};

const SIZE_CLASSES: Record<ChipSize, string> = {
  sm: "px-[9px] py-[2px] text-xs",
  md: "px-[11px] py-[3px] text-xs",
};

export interface ChipProps extends ComponentPropsWithRef<"span"> {
  tone?: ChipTone;
  size?: ChipSize;
  /** JetBrains Mono — quantities, deltas, box codes. */
  mono?: boolean;
  /** Renders a trailing × and hover affordance; chip becomes clickable. */
  onRemove?: () => void;
}

/**
 * Pill chip (prototype: 1px border, 9999px radius, 2px 9px padding,
 * mono for numeric content). Status is voiced by border+text color only.
 */
export function Chip({
  tone = "default",
  size = "sm",
  mono = false,
  onRemove,
  className,
  children,
  ...props
}: ChipProps) {
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap",
    TONE_CLASSES[tone],
    SIZE_CLASSES[size],
    mono && "font-mono",
    onRemove &&
      "cursor-pointer transition-colors select-none hover:border-smark-orange",
    className,
  );

  if (onRemove) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={onRemove}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onRemove();
          }
        }}
        className={classes}
        {...props}
      >
        {children}
        <span aria-hidden className="text-sm leading-none text-smoke">
          ×
        </span>
      </span>
    );
  }

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
