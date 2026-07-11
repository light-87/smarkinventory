"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** neutral = ash active pill (speed picker) · accent = orange active pill (tier picker) */
  variant?: "neutral" | "accent";
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/**
 * Segmented pill control (prototype: #0f0f0f track, 1px charcoal border,
 * 3px padding; active segment is an inner pill).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "neutral",
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-charcoal bg-surface-well p-[3px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "cursor-pointer rounded-full border border-transparent transition-colors select-none",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-smark-orange",
              "disabled:pointer-events-none disabled:opacity-40",
              size === "sm" ? "h-[30px] px-3.5 text-xs" : "h-9 px-4 text-[13px]",
              variant === "neutral" &&
                (active
                  ? "border-slate bg-ash text-snow"
                  : "text-smoke hover:text-snow"),
              variant === "accent" &&
                (active
                  ? "bg-smark-orange font-medium text-white"
                  : "text-silver-mist hover:text-snow"),
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
