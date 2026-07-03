"use client";

import { cn } from "@/lib/cn";

export interface CategoryChipsProps {
  options: readonly string[];
  value: string | null;
  onChange: (value: string) => void;
}

/** Required category picker on the New-part form (plan/tab-receive.md §2A). */
export function CategoryChips({ options, value, onChange }: CategoryChipsProps) {
  return (
    <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
      {options.map((category) => {
        const active = category === value;
        return (
          <button
            key={category}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(category)}
            className={cn(
              "h-8 cursor-pointer rounded-full border px-3.5 text-xs transition-colors select-none",
              active
                ? "border-smark-orange bg-surface-accent text-smark-orange"
                : "border-charcoal text-silver-mist hover:bg-ash hover:text-snow",
            )}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}
