"use client";

import { cn } from "@/lib/cn";
import { ExpenseCategorySchema, type ExpenseCategory } from "@/types/db";

const CATEGORIES = ExpenseCategorySchema.options;

export interface CategoryChipsProps {
  value: ExpenseCategory | null;
  onChange: (value: ExpenseCategory) => void;
}

/** Required category picker on the entry form — mirrors components/receive/category-chips.tsx's pattern (own local copy; components/<package> isn't cross-importable per docs/OWNERSHIP.md). */
export function CategoryChips({ value, onChange }: CategoryChipsProps) {
  return (
    <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
      {CATEGORIES.map((category) => {
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
