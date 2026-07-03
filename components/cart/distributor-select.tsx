"use client";

import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface DistributorSelectOption {
  value: string;
  label: string;
}

export interface DistributorSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: readonly DistributorSelectOption[];
  placeholder?: string;
}

/**
 * Small local styled `<select>` — components/ui has no dropdown primitive
 * yet (OWNERSHIP.md: propose additions to the shared kit, don't add one in
 * place). Mirrors the Input well/border/focus treatment; a package-local
 * twin of lib/receive's NativeSelect (component code isn't a cross-import
 * allowance — OWNERSHIP.md — so this package keeps its own copy).
 */
export function DistributorSelect({ options, placeholder, className, ...props }: DistributorSelectProps) {
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
