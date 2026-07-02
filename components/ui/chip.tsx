import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

export type ChipTone =
  | "default" /* charcoal border · smoke text — locations, quiet meta   */
  | "neutral" /* charcoal border · silver text — counts, mid emphasis   */
  | "bright" /* charcoal border · snow text — emphasized values         */
  | "accent" /* orange border + text — low stock, running, alerts       */
  | "success" /* rationed green — in-stock / passed                     */
  | "soft"; /* ash fill + slate border — active filter chips            */

export type ChipSize = "sm" | "md";

const TONE_CLASSES: Record<ChipTone, string> = {
  default: "border-charcoal text-smoke",
  neutral: "border-charcoal text-silver-mist",
  bright: "border-charcoal text-snow",
  accent: "border-smark-orange text-smark-orange",
  success: "border-forest-depth text-phosphor-green",
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
