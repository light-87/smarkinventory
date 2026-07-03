import type { ReactNode, SVGProps } from "react";
import type { NotificationKind } from "@/types/db";

/**
 * components/notifications/icons.tsx — bell + per-`kind` glyphs. No icon
 * package installed (CLAUDE.md: don't `bun add`); hand-rolled to the exact
 * same convention as components/shell/icons.tsx (viewBox 24, stroke=
 * currentColor, 1.5 weight, round caps) — a local copy rather than an
 * import, since that file is auth-shell's, not a shared lib.
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

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.6 5.7 1.9 6.1.2.2 0 .6-.3.6H4.4c-.3 0-.5-.4-.3-.6C4.4 14.7 6 13.5 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </IconBase>
  );
}

/** `arrival` — a box arriving for put-away. */
function ArrivalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12v6.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V12" />
      <path d="M3 12h4.5l1.7 2.6h5.6L16.5 12H21" />
      <path d="M12 3v8" />
      <path d="M8.5 8 12 11.5 15.5 8" />
    </IconBase>
  );
}

/** `task_assigned` — a checklist item. */
function TaskAssignedIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M8 12.3 10.5 14.8 16 9.3" />
    </IconBase>
  );
}

/** `rule_pending` — a suggestion awaiting review (sparkle, mirrors AiMemoryIcon's motif). */
function RulePendingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3c.9 2.2 2 3.3 4.3 4.2-2.3.9-3.4 2-4.3 4.2-.9-2.2-2-3.3-4.3-4.2C10 6.3 11.1 5.2 12 3Z" />
      <path d="M18.5 13c.4 1 .9 1.5 1.9 1.9-1 .4-1.5.9-1.9 1.9-.4-1-.9-1.5-1.9-1.9 1-.4 1.5-.9 1.9-1.9Z" />
    </IconBase>
  );
}

/** `low_stock` — warning triangle. */
function LowStockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4 21.5 20H2.5Z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </IconBase>
  );
}

/** `run_done` — a finished agent run. */
function RunDoneIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.2 12.3 10.7 14.8 15.8 9.3" />
    </IconBase>
  );
}

/** `expense_draft` — a receipt / rupee note. */
function ExpenseDraftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </IconBase>
  );
}

/** `portal_comment` — a chat bubble from the client portal. */
function PortalCommentIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4Z" />
    </IconBase>
  );
}

/** `kind` → icon (SCHEMA.md §7 `smark_notifications.kind`), the single lookup the bell uses per row. */
export const KIND_ICONS: Record<NotificationKind, (props: IconProps) => ReactNode> = {
  arrival: ArrivalIcon,
  task_assigned: TaskAssignedIcon,
  rule_pending: RulePendingIcon,
  low_stock: LowStockIcon,
  run_done: RunDoneIcon,
  expense_draft: ExpenseDraftIcon,
  portal_comment: PortalCommentIcon,
};
