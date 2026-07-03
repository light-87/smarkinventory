import type { ReactNode, SVGProps } from "react";

/**
 * components/search/icons.tsx — magnifier + per-section glyphs for the
 * command palette. Hand-rolled to the same convention as
 * components/shell/icons.tsx (viewBox 24, stroke=currentColor, 1.5 weight,
 * round caps) — a local copy, not an import (that file is auth-shell's).
 */

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: { children: ReactNode } & IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="20" y1="20" x2="15.3" y2="15.3" />
    </IconBase>
  );
}

/** Scan / code shape — reused for the "jump straight there" scan-match row. */
export function ScanIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M4 16v2a2 2 0 0 0 2 2h2" />
      <path d="M20 8V6a2 2 0 0 0-2-2h-2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </IconBase>
  );
}

export function PartResultIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
    </IconBase>
  );
}

export function ProjectResultIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5V7Z" />
    </IconBase>
  );
}

export function BomResultIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.8" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </IconBase>
  );
}

export function OrderResultIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9.5" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <path d="M2.5 3.5h2l2.2 12a2 2 0 0 0 2 1.7h8a2 2 0 0 0 2-1.6l1.6-8.1H6" />
    </IconBase>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </IconBase>
  );
}
