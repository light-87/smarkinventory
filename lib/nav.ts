/**
 * lib/nav.ts — canonical nav config (rail / bottom bar / More sheet / header
 * title). Per docs/OWNERSHIP.md this file is "integrator only" but explicitly
 * created by auth-shell's first PR — every other package's routes are wired
 * in HERE, not by editing app/(app)/layout.tsx directly (that file is
 * auth-shell's alone). Future packages: ask the integrator to add/adjust an
 * entry rather than importing around this module.
 *
 * Source of truth for grouping/labels/order: FEATURES.md §5 header +
 * plan/tab-login-shell.md R2-02/03/07/09/20/22/26 (nav renames + mobile
 * "More" tab). Role visibility is NOT decided here — every render filters
 * through lib/auth/roles' `canSee`, so this file only ever changes when a
 * surface is added/renamed, never per-role.
 */

import { canSee, type Area, type Role } from "@/lib/auth/roles";

export type NavGroupId = "overview" | "operate" | "projects" | "team" | "footer";

export interface NavItem {
  /** Stable id — also the key into components/shell/icons.tsx's NAV_ICONS map. */
  id: string;
  area: Area;
  label: string;
  href: string;
  group: NavGroupId;
}

/** Desktop rail section headers, in render order. `footer` renders below the divider, unlabeled. */
export const NAV_GROUP_LABELS: Record<Exclude<NavGroupId, "footer">, string> = {
  overview: "Overview",
  operate: "Operate",
  projects: "Projects",
  team: "Team",
};

export const RAIL_GROUP_ORDER: readonly Exclude<NavGroupId, "footer">[] = [
  "overview",
  "operate",
  "projects",
  "team",
];

/**
 * The full surface list — desktop rail order top to bottom, `footer` group
 * rendered separately below a divider (AI Memory · Settings).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", area: "dashboard", label: "Dashboard", href: "/dashboard", group: "overview" },
  { id: "inventory", area: "inventory", label: "Inventory", href: "/inventory", group: "overview" },
  { id: "shelves", area: "shelves", label: "Shelves", href: "/shelves", group: "overview" },
  { id: "scan", area: "scan", label: "Scan", href: "/scan", group: "operate" },
  { id: "bulk_takeout", area: "bulk_takeout", label: "Bulk takeout", href: "/bulk-takeout", group: "operate" },
  { id: "receive", area: "receive", label: "Receive", href: "/receive", group: "operate" },
  { id: "projects", area: "projects", label: "Projects", href: "/projects", group: "projects" },
  { id: "cart", area: "cart", label: "Cart", href: "/cart", group: "projects" },
  { id: "daily_reports", area: "daily_reports", label: "Daily Reports", href: "/daily", group: "team" },
  { id: "attendance", area: "attendance", label: "Attendance", href: "/attendance", group: "team" },
  // (0011) visible to every role — DOB/DOJ/bank/PAN self-edit + own document uploads.
  { id: "profile", area: "profile", label: "My Profile", href: "/settings/profile", group: "team" },
  { id: "ai_memory", area: "ai_memory", label: "AI Memory", href: "/ai-memory", group: "footer" },
  { id: "settings", area: "settings", label: "Settings", href: "/settings", group: "footer" },
] as const;

/**
 * Mobile bottom bar's 4 fixed slots (R2-22) — identical for every role since
 * none of dashboard/inventory/scan/projects is ever `hidden` (worst case,
 * accountant, they're all `read`). The 5th slot is always "More", rendered
 * by BottomBar itself, not listed here.
 */
export const MOBILE_PRIMARY_IDS: readonly string[] = ["dashboard", "inventory", "scan", "projects"];

/** Prefix match so a nested route (e.g. `/projects/:id/boms/:bomId`) still lights up "Projects". */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Every nav item this role can see, in canonical order. */
export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => canSee(role, item.area));
}

/** The 4 primary mobile items this role can see (role-filtered defensively; see MOBILE_PRIMARY_IDS). */
export function visibleMobilePrimaryItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => MOBILE_PRIMARY_IDS.includes(item.id) && canSee(role, item.area));
}

/** Everything else the role can see — the More-sheet contents (R2-22). */
export function visibleMoreSheetItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !MOBILE_PRIMARY_IDS.includes(item.id) && canSee(role, item.area));
}

/**
 * Header screen title: exact nav-item label for a matched surface, else a
 * best-effort title-cased first path segment (covers routes owned by other
 * packages that aren't top-level nav items yet, e.g. `/part/:pid`).
 */
export function titleForPath(pathname: string, role: Role): string {
  const match = visibleNavItems(role).find((item) => isNavItemActive(pathname, item.href));
  if (match) return match.label;

  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return "SmarkStock";
  return first
    .split("-")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}
