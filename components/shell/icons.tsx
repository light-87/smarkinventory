import type { ReactNode, SVGProps } from "react";

/**
 * components/shell/icons.tsx — small stroke-icon set for the shell chrome
 * (rail / bottom bar / More sheet / header / avatar menu). No icon package
 * is installed (CLAUDE.md: don't `bun add` — note it instead); these follow
 * the same hand-rolled convention already used in app/design-preview
 * (viewBox 24, stroke=currentColor, 1.5 weight, round caps).
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

export function DashboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="13.5" y="12.5" width="7.5" height="8.5" rx="1.5" />
      <rect x="3" y="16" width="7.5" height="5" rx="1.5" />
    </IconBase>
  );
}

export function InventoryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </IconBase>
  );
}

export function ShelvesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3.5" width="18" height="17" rx="1.5" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </IconBase>
  );
}

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

export function BulkTakeoutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 9 6 3h12l3 6" />
      <rect x="3" y="9" width="18" height="11.5" rx="1.5" />
      <path d="M9 13.5 11 15.5 15.5 11.5" />
    </IconBase>
  );
}

export function ReceiveIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12v6.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5V12" />
      <path d="M3 12h4.5l1.7 2.6h5.6L16.5 12H21" />
      <path d="M12 3v8" />
      <path d="M8.5 8 12 11.5 15.5 8" />
    </IconBase>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5V7Z" />
    </IconBase>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9.5" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <path d="M2.5 3.5h2l2.2 12a2 2 0 0 0 2 1.7h8a2 2 0 0 0 2-1.6l1.6-8.1H6" />
    </IconBase>
  );
}

export function DailyReportsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="15.5" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <path d="M8 15.2 10.2 17.4 15.5 12.5" />
    </IconBase>
  );
}

export function AttendanceIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
      <path d="M8.2 3.4 9.6 2l1.1 1.1L12 2l1.3 1.1L14.4 2l1.4 1.4" />
    </IconBase>
  );
}

export function ExpensesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 8h6.5" />
      <path d="M9 11.2h4.5" />
      <path d="M9.3 11.2c3.6 0 5.7.9 5.7 3.1S12.6 17 9 17" />
      <path d="M9.3 17 14.5 17" />
    </IconBase>
  );
}

export function AiMemoryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3c.9 2.2 2 3.3 4.3 4.2-2.3.9-3.4 2-4.3 4.2-.9-2.2-2-3.3-4.3-4.2C10 6.3 11.1 5.2 12 3Z" />
      <path d="M18.5 13c.4 1 .9 1.5 1.9 1.9-1 .4-1.5.9-1.9 1.9-.4-1-.9-1.5-1.9-1.9 1-.4 1.5-.9 1.9-1.9Z" />
      <path d="M6 15c.3.8.7 1.2 1.5 1.5C6.7 16.8 6.3 17.2 6 18c-.3-.8-.7-1.2-1.5-1.5.8-.3 1.2-.7 1.5-1.5Z" />
    </IconBase>
  );
}

export function ProfileIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c0-3.9 3.4-6.5 7.5-6.5s7.5 2.6 7.5 6.5" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a1.9 1.9 0 1 1-3.8 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a1.9 1.9 0 1 1 0-3.8h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A1.9 1.9 0 1 1 7 4.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3.4a1.9 1.9 0 1 1 3.8 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a1.9 1.9 0 1 1 0 3.8h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </IconBase>
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

export function MoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.3" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.3" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.3" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.3" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </IconBase>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M1.7 12S5.2 5.5 12 5.5 22.3 12 22.3 12 18.8 18.5 12 18.5 1.7 12 1.7 12Z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.7 5.2A11.6 11.6 0 0 1 12 5.1c6.8 0 10.3 6.9 10.3 6.9a13 13 0 0 1-3 4M6.6 6.6C3.9 8.4 1.7 12 1.7 12S5.2 18.9 12 18.9a10.4 10.4 0 0 0 5.3-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </IconBase>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <polyline points="15 17 20 12 15 7" />
      <line x1="20" y1="12" x2="9" y2="12" />
    </IconBase>
  );
}

/** id → icon, keyed by lib/nav.ts NavItem.id — the single lookup Rail/BottomBar/MoreSheet share. */
export const NAV_ICONS: Record<string, (props: IconProps) => ReactNode> = {
  dashboard: DashboardIcon,
  inventory: InventoryIcon,
  shelves: ShelvesIcon,
  scan: ScanIcon,
  bulk_takeout: BulkTakeoutIcon,
  receive: ReceiveIcon,
  projects: ProjectsIcon,
  cart: CartIcon,
  daily_reports: DailyReportsIcon,
  attendance: AttendanceIcon,
  expenses: ExpensesIcon,
  profile: ProfileIcon,
  ai_memory: AiMemoryIcon,
  settings: SettingsIcon,
};
