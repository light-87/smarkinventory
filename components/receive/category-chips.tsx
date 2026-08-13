"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface CategoryChipsProps {
  options: readonly string[];
  value: string | null;
  onChange: (value: string) => void;
}

/**
 * Required category picker on the New-part form (plan/tab-receive.md §2A).
 *
 * "+ New" is how a category gets defined (client request, 2026-08-13: "need
 * option to define new category and subcategory"). There is no categories
 * table — `smark_parts.category` is free text and the list is derived from
 * what parts actually say — so typing a name here IS creating the category.
 * It then appears in the filters, in Settings → Categories, and as a chip on
 * this form for the next person.
 */
export function CategoryChips({ options, value, onChange }: CategoryChipsProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  // A category typed here won't be in `options` until the part is saved, so
  // show it as a chip of its own in the meantime.
  const custom = value && !options.includes(value) ? value : null;
  const chips = custom ? [...options, custom] : options;

  function commit() {
    const name = draft.trim();
    if (name) onChange(name);
    setDraft("");
    setAdding(false);
  }

  return (
    <div role="radiogroup" aria-label="Category" className="flex flex-wrap items-center gap-2">
      {chips.map((category) => {
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

      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder="New category"
          aria-label="New category name"
          className="h-8 w-[150px] rounded-full border border-smark-orange bg-surface-well px-3.5 text-xs text-snow outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-8 cursor-pointer rounded-full border border-dashed border-charcoal px-3.5 text-xs text-smoke transition-colors hover:text-snow"
        >
          + New
        </button>
      )}
    </div>
  );
}
