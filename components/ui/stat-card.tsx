import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatTone = "default" | "accent" | "muted" | "success" | "warn" | "danger";

const TONE_CLASSES: Record<StatTone, string> = {
  default: "text-snow",
  accent: "text-smark-orange",
  muted: "text-smoke",
  success: "text-phosphor-green",
  warn: "text-warn",
  danger: "text-smark-orange-soft",
};

/**
 * A 4px left accent bar in the tone colour turns each tile into a directional,
 * scannable status card (owner: "reason for every colour"). Neutral tones keep
 * a charcoal bar so the whole grid stays visually aligned.
 */
const ACCENT_BAR: Record<StatTone, string> = {
  default: "border-l-charcoal",
  accent: "border-l-smark-orange",
  muted: "border-l-charcoal",
  success: "border-l-phosphor-green",
  warn: "border-l-warn",
  danger: "border-l-smark-orange-soft",
};

/**
 * State tones also fill the tile with their tinted "pod" surface so a metric
 * that means something (low stock, out) reads as colour at a glance, while a
 * plain count (default/muted) stays white — colour only where it's meaningful.
 */
const TONE_BG: Record<StatTone, string> = {
  default: "bg-surface",
  muted: "bg-surface",
  accent: "bg-surface-accent",
  success: "bg-surface-success",
  warn: "bg-surface-warn",
  danger: "bg-surface-danger",
};

export interface StatCardProps extends ComponentPropsWithRef<"div"> {
  value: ReactNode;
  label: ReactNode;
  tone?: StatTone;
  /** Render the value in JetBrains Mono (codes); default is Inter tabular-nums. */
  mono?: boolean;
}

/**
 * Dashboard stat tile (prototype: #141414 card, 36px/400 value with
 * tabular numerals, 12px smoke label).
 */
export function StatCard({
  value,
  label,
  tone = "default",
  mono = false,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-charcoal border-l-4 px-5 py-[18px]",
        TONE_BG[tone],
        ACCENT_BAR[tone],
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "text-4xl leading-none font-normal tabular-nums",
          mono && "font-mono",
          TONE_CLASSES[tone],
        )}
      >
        {value}
      </div>
      <div className="mt-2.5 text-caption text-smoke">{label}</div>
    </div>
  );
}
