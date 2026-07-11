import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  /** Error styling (danger-red border) + aria-invalid. */
  invalid?: boolean;
}

/**
 * Multi-line text input — the textarea sibling of `Input`, sharing the same
 * well/border/focus treatment. Replaces the hand-rolled `<textarea>`s that were
 * duplicated across the portal and other forms.
 */
export function Textarea({ invalid = false, className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full resize-none rounded-lg border bg-surface-well px-3.5 py-2.5 text-sm text-snow outline-none",
        "caret-smark-orange transition-colors placeholder:text-smoke",
        "focus:border-smark-orange",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid ? "border-smark-orange-soft" : "border-charcoal",
        className,
      )}
      {...props}
    />
  );
}
