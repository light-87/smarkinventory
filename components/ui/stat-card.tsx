import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatTone = "default" | "accent" | "muted" | "success";

const TONE_CLASSES: Record<StatTone, string> = {
  default: "text-snow",
  accent: "text-smark-orange",
  muted: "text-smoke",
  success: "text-phosphor-green",
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
        "rounded-2xl border border-charcoal bg-surface px-5 py-[18px]",
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
