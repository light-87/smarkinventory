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
import { effectiveCanSee } from "@/lib/rbac/access";
import type { Module } from "@/lib/rbac/types";

/**
 * (0013 nav categorization) 4 hybrid groups + `overview` (Dashboard, always
 * pinned above the groups, never collapsible) + `footer` (AI Memory ·
 * Settings, below the divider). The 4 category labels (`Inventory` /
 * `Ordering` / `Team` / `Projects`) are exact — Rail renders them as
 * collapsible, collapsed-by-default section headers; the dashboard's 4-box
 * launcher (app/(app)/dashboard/page.tsx) uses the same ids/labels.
 */
export type NavGroupId = "overview" | "inventory" | "ordering" | "team" | "projects" | "footer";

/** Desktop rail's 4 collapsible section headers, in render order. `overview`/`footer` are not collapsible (rendered separately by Rail). */
export const NAV_GROUP_LABELS: Record<Exclude<NavGroupId, "overview" | "footer">, string> = {
  inventory: "Inventory",
  ordering: "Ordering",
  team: "Team",
  projects: "Projects",
};

export const RAIL_GROUP_ORDER: readonly Exclude<NavGroupId, "overview" | "footer">[] = [
  "inventory",
  "ordering",
  "team",
  "projects",
];

/**
 * Per-group wayfinding accent (tokens defined in app/globals.css `--color-nav-*`).
 * Consumed by the desktop rail (active mark + icon), the mobile bottom bar, and
 * the dashboard launcher so each section reads by a stable hue. Full class
 * strings (not built dynamically) so Tailwind's scanner emits the utilities.
 * `footer` (AI Memory · Settings) stays a neutral grey — utility chrome, not a
 * category.
 */
export const NAV_GROUP_ACCENT: Record<NavGroupId, { text: string; bg: string; border: string }> = {
  overview: { text: "text-nav-overview", bg: "bg-nav-overview", border: "border-nav-overview" },
  inventory: { text: "text-nav-inventory", bg: "bg-nav-inventory", border: "border-nav-inventory" },
  ordering: { text: "text-nav-ordering", bg: "bg-nav-ordering", border: "border-nav-ordering" },
  team: { text: "text-nav-team", bg: "bg-nav-team", border: "border-nav-team" },
  projects: { text: "text-nav-projects", bg: "bg-nav-projects", border: "border-nav-projects" },
  footer: { text: "text-smoke", bg: "bg-smoke", border: "border-smoke" },
};

export interface NavItem {
  /** Stable id — also the key into components/shell/icons.tsx's NAV_ICONS map. */
  id: string;
  area: Area;
  label: string;
  href: string;
  group: NavGroupId;
}

/**
 * The full surface list — desktop rail order top to bottom, `footer` group
 * rendered separately below a divider (AI Memory · Settings).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", area: "dashboard", label: "Dashboard", href: "/dashboard", group: "overview" },
  { id: "inventory", area: "inventory", label: "Inventory", href: "/inventory", group: "inventory" },
  { id: "shelves", area: "shelves", label: "Shelves", href: "/shelves", group: "inventory" },
  { id: "scan", area: "scan", label: "Scan", href: "/scan", group: "inventory" },
  { id: "bulk_takeout", area: "bulk_takeout", label: "Bulk takeout", href: "/bulk-takeout", group: "inventory" },
  { id: "receive", area: "receive", label: "Receive", href: "/receive", group: "inventory" },
  { id: "projects", area: "projects", label: "Projects", href: "/projects", group: "projects" },
  { id: "cart", area: "cart", label: "Cart", href: "/cart", group: "ordering" },
  { id: "daily_reports", area: "daily_reports", label: "Daily Reports", href: "/daily", group: "team" },
  { id: "attendance", area: "attendance", label: "Attendance", href: "/attendance", group: "team" },
  // (0018) Owner-only per-employee dashboard — canSee() hides it for employee/accountant (area "team" is hidden for both).
  { id: "team", area: "team", label: "Employees", href: "/team", group: "team" },
  // Owner-only PM analytics — canSee() hides this for employee/accountant automatically (area is "hidden" for both in roles.ts).
  { id: "project_dashboard", area: "project_dashboard", label: "Project Dashboard", href: "/project-dashboard", group: "projects" },
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

/**
 * The nav GROUP the current path belongs to — the module-hue "you are here"
 * signal (matches the same active item `titleForPath` resolves). Unmatched
 * routes (e.g. `/part/:pid`) fall back to `overview` (cobalt). Pair with
 * NAV_GROUP_ACCENT for the header/section accent.
 */
export function groupForPath(pathname: string, role: Role): NavGroupId {
  const match = visibleNavItems(role).find((item) => isNavItemActive(pathname, item.href));
  return match?.group ?? "overview";
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
 * (0013) Gated twins of the three functions above — `canSee` PLUS, for
 * `employee` only, module grants (lib/rbac/access.ts effectiveCanSee).
 * Additive: `visibleNavItems`/`visibleMobilePrimaryItems`/
 * `visibleMoreSheetItems` above are untouched (still pure role-based; any
 * existing caller — including tests/unit/nav.test.ts if present — keeps
 * working unchanged). The shell chrome (Rail/BottomBar/MoreSheet) calls
 * these gated variants instead, passing the session user's `grantedModules`.
 */
export function effectiveVisibleNavItems(role: Role, grantedModules: readonly Module[]): NavItem[] {
  return NAV_ITEMS.filter((item) => effectiveCanSee(role, item.area, grantedModules));
}

export function effectiveVisibleMobilePrimaryItems(role: Role, grantedModules: readonly Module[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => MOBILE_PRIMARY_IDS.includes(item.id) && effectiveCanSee(role, item.area, grantedModules),
  );
}

export function effectiveVisibleMoreSheetItems(role: Role, grantedModules: readonly Module[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !MOBILE_PRIMARY_IDS.includes(item.id) && effectiveCanSee(role, item.area, grantedModules),
  );
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
