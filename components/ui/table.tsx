import type { ComponentPropsWithRef, CSSProperties } from "react";
import { cn } from "@/lib/cn";

export interface TableShellProps extends ComponentPropsWithRef<"table"> {
  /** Min table width before the wrapper scrolls horizontally (px). */
  minWidth?: number;
  /** Class for the scrollable wrapper div. */
  wrapperClassName?: string;
}

/**
 * Data-table shell (prototype inventory grid): scroll wrapper + collapsed
 * borders. Compose with TableHead/Th/TableBody/Tr/Td.
 */
export function TableShell({
  minWidth,
  wrapperClassName,
  className,
  style,
  children,
  ...props
}: TableShellProps) {
  const tableStyle: CSSProperties | undefined = minWidth
    ? { minWidth, ...style }
    : style;
  return (
    <div className={cn("overflow-auto", wrapperClassName)}>
      <table
        className={cn("w-full border-collapse", className)}
        style={tableStyle}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHead(props: ComponentPropsWithRef<"thead">) {
  return <thead {...props} />;
}

export function TableBody(props: ComponentPropsWithRef<"tbody">) {
  return <tbody {...props} />;
}

export interface ThProps extends ComponentPropsWithRef<"th"> {
  /** Sticky header cells (default) pin to the scroll container top. */
  sticky?: boolean;
  align?: "left" | "right" | "center";
}

/** Header cell: 11px uppercase smoke on canvas, charcoal bottom border. */
export function Th({
  sticky = true,
  align = "left",
  className,
  ...props
}: ThProps) {
  return (
    <th
      className={cn(
        "border-b border-charcoal bg-canvas px-3.5 py-[11px] text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-smoke uppercase",
        sticky && "sticky top-0 z-[2]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
      {...props}
    />
  );
}

export interface TrProps extends ComponentPropsWithRef<"tr"> {
  /** Row hover + pointer for clickable rows (prototype: hover #242424). */
  interactive?: boolean;
}

export function Tr({ interactive = false, className, ...props }: TrProps) {
  return (
    <tr
      className={cn(
        interactive && "cursor-pointer transition-colors hover:bg-ash",
        className,
      )}
      {...props}
    />
  );
}

export interface TdProps extends ComponentPropsWithRef<"td"> {
  /** JetBrains Mono — PIDs, MPNs, quantities, box codes. */
  mono?: boolean;
  align?: "left" | "right" | "center";
}

/** Body cell: 13px, hairline #1a1a1a divider. */
export function Td({
  mono = false,
  align = "left",
  className,
  ...props
}: TdProps) {
  return (
    <td
      className={cn(
        "border-b border-border-hairline px-3.5 py-[11px] text-[15px] text-silver-mist",
        mono && "font-mono",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}
