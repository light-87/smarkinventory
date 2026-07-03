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
 * Small local styled `<select>` — components/ui has no dropdown primitive
 * yet (OWNERSHIP.md: propose additions to the shared kit, don't add one in
 * place; components/receive/native-select.tsx is the same idiom, package by
 * package). Matches the Input well/border/focus treatment.
 */
export function NativeSelect({ options, placeholder, className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none",
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
