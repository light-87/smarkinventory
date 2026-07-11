import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type InputSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: "h-[34px] px-3 text-[14px]",
  md: "h-10 px-3.5 text-sm",
  lg: "h-11 px-3.5 text-sm",
};

export interface InputProps
  extends Omit<ComponentPropsWithRef<"input">, "size"> {
  /** `size` is taken by the native attr — use uiSize. */
  uiSize?: InputSize;
  /** JetBrains Mono — part codes, scans, quantities. */
  mono?: boolean;
  /** Error styling (soft-orange border) + aria-invalid. */
  invalid?: boolean;
  /** Leading 16px icon slot (adds left padding). */
  leading?: ReactNode;
  /** Class for the relative wrapper rendered when `leading` is set. */
  wrapperClassName?: string;
}

/**
 * Dark input (prototype: #0f0f0f well, 1px #2e2e2e border, 8px radius,
 * orange border on focus — the border IS the focus ring, no glow).
 */
export function Input({
  uiSize = "md",
  mono = false,
  invalid = false,
  leading,
  className,
  wrapperClassName,
  ...props
}: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-lg border bg-surface-well text-snow outline-none",
        "caret-smark-orange transition-colors placeholder:text-smoke",
        "focus:border-smark-orange",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid ? "border-smark-orange-soft" : "border-charcoal",
        SIZE_CLASSES[uiSize],
        mono && "font-mono text-[14px]",
        leading && "pl-9",
        className,
      )}
      {...props}
    />
  );

  if (!leading) return input;

  return (
    <div className={cn("relative", wrapperClassName)}>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-smoke [&_svg]:size-full"
      >
        {leading}
      </span>
      {input}
    </div>
  );
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label / control / hint-or-error stack for forms. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label != null && (
        <label htmlFor={htmlFor} className="text-[14px] text-silver-mist">
          {label}
        </label>
      )}
      {children}
      {error != null ? (
        <p className="text-caption text-smark-orange-soft">{error}</p>
      ) : hint != null ? (
        <p className="text-caption text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
