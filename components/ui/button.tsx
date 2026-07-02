import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "outline" | "accent-outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** primary = orange pill · outline = charcoal pill · accent-outline = orange border · ghost = quiet text */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Optional leading icon (16px slot). */
  icon?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-smark-orange font-medium text-obsidian hover:bg-smark-orange-hover",
  outline: "border border-charcoal text-snow hover:bg-ash",
  "accent-outline":
    "border border-smark-orange text-snow hover:bg-surface-accent-hover",
  ghost: "text-smoke hover:bg-surface-raised hover:text-snow",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-[30px] px-3.5 text-xs",
  md: "h-[38px] px-[18px] text-[13px]",
  lg: "h-11 px-[22px] text-sm",
  xl: "h-12 px-[22px] text-[15px]",
};

/**
 * SmarkStock pill button (prototype: orange fill w/ #121212 label, or
 * transparent pill w/ 1px charcoal border). Radius is always 9999px.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full transition-colors select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-smark-orange",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 flex-none animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : icon ? (
        <span aria-hidden className="size-4 flex-none [&_svg]:size-full">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
