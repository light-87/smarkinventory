import type { ReactNode, SVGProps } from "react";

/**
 * components/scan/icons.tsx — glyphs for the full-screen camera scanner
 * overlay (torch / close / manual-entry / camera-error). No icon package
 * installed (CLAUDE.md: don't `bun add`); hand-rolled to the exact same
 * convention as components/shell/icons.tsx (viewBox 24, stroke=currentColor,
 * 1.5 weight, round caps) — a local copy rather than an import, since that
 * file is auth-shell's, not a shared lib.
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

/** Torch/flash toggle — shown only when the active camera track supports it. */
export function TorchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" />
    </IconBase>
  );
}

/** Close the scanner overlay. */
export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </IconBase>
  );
}

/** Pencil — "Enter code manually". */
export function EditIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15.5 4.5 19.5 8.5 8 20H4v-4Z" />
      <path d="M13.5 6.5 17.5 10.5" />
    </IconBase>
  );
}

/** Plain camera glyph for the permission/no-camera/load-failure error card. */
export function CameraIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 8.5A2 2 0 0 1 6 6.5h1.2l1-2h7.6l1 2H18a2 2 0 0 1 2 2v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="12.5" r="3.6" />
    </IconBase>
  );
}
