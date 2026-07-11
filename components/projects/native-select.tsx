"use client";

import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface NativeSelectOption {
  value: string;
  label: string;
}

export interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: readonly NativeSelectOption[];
  placeholder?: string;
}

/**
 * Package-local styled `<select>` for the PM surface. components/ui has no
 * dropdown primitive yet, and docs/OWNERSHIP.md forbids cross-importing
 * another package's local one (e.g. components/settings/native-select.tsx) —
 * so this mirrors that treatment for components/projects. Matches the Input
 * well/border/focus styling.
 */
export function NativeSelect({ options, placeholder, className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none",
        "focus:border-smark-orange disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
