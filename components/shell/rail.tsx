"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { type Role } from "@/lib/auth/roles";
import type { Module } from "@/lib/rbac/types";
import {
  NAV_GROUP_ACCENT,
  NAV_GROUP_LABELS,
  RAIL_GROUP_ORDER,
  effectiveVisibleNavItems,
  isNavItemActive,
  type NavItem,
} from "@/lib/nav";
import { NAV_ICONS } from "./icons";
import { NavLinkPending } from "./nav-link-pending";

/**
 * Desktop left rail (>=768px) — Dashboard pinned at top, then the 4 category
 * sections (Inventory/Ordering/Team/Projects, 0013 nav categorization), then AI
 * Memory + Settings below a divider. Sections are ALWAYS EXPANDED (owner: "keep
 * it expanded, no need to shrink") — every tab the role can reach is always in
 * view, no click-to-open. Each section carries its own wayfinding hue
 * (NAV_GROUP_ACCENT / --color-nav-*): the section header, and the active item's
 * left bar + icon, are tinted so the eye finds a section by colour. A role
 * whose visible items only populate 1-2 of the 4 categories simply never renders
 * the others. Visibility runs through `effectiveVisibleNavItems` (lib/nav.ts) —
 * canSee() PLUS, for `employee`, module grants (lib/rbac).
 */
export function Rail({
  role,
  pathname,
  grantedModules = [],
  navBadges = {},
  collapsed = false,
  onToggle,
}: {
  role: Role;
  pathname: string;
  grantedModules?: readonly Module[];
  navBadges?: Record<string, boolean>;
  /** Icons-only mode — see `RailToggle` for why this exists. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const items = effectiveVisibleNavItems(role, grantedModules);
  const overviewItems = items.filter((item) => item.group === "overview");
  const footerItems = items.filter((item) => item.group === "footer");

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh flex-none flex-col border-r border-charcoal bg-canvas transition-[width] duration-200 md:flex",
        collapsed ? "w-[68px]" : "w-[236px]",
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-border-faint py-5",
          collapsed ? "justify-center px-2" : "gap-[11px] px-5",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image benefit */}
        <img src="/brand/smark-mark.svg" alt="" className="h-[15px] w-auto flex-none" />
        {!collapsed && <span className="flex-1 text-[17px] font-medium text-snow">SmarkStock</span>}
        <RailToggle collapsed={collapsed} onToggle={onToggle} />
      </div>

      <nav
        className={cn(
          "flex flex-1 flex-col overflow-y-auto overflow-x-hidden py-3",
          collapsed ? "items-center px-2" : "pr-3 pl-4",
        )}
      >
        {overviewItems.map((item) => (
          <RailLink
            key={item.id}
            item={item}
            active={isNavItemActive(pathname, item.href)}
            badge={navBadges[item.id]}
            collapsed={collapsed}
          />
        ))}

        {RAIL_GROUP_ORDER.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <div key={group} className={cn("mb-1", collapsed && "flex w-full flex-col items-center")}>
              {collapsed ? (
                // The section label is what carries the hue when expanded; a
                // tinted rule keeps the same grouping readable at 68px.
                <div aria-hidden className={cn("my-2 h-px w-6 rounded-full opacity-60", NAV_GROUP_ACCENT[group].bg)} />
              ) : (
                <div
                  className={cn(
                    "px-2 pt-3.5 pb-1 text-[12px] font-semibold tracking-[0.08em] uppercase",
                    NAV_GROUP_ACCENT[group].text,
                  )}
                >
                  {NAV_GROUP_LABELS[group]}
                </div>
              )}
              {groupItems.map((item) => (
                <RailLink
                  key={item.id}
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  badge={navBadges[item.id]}
                  collapsed={collapsed}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {footerItems.length > 0 && (
        <div className={cn("border-t border-border-faint py-3", collapsed ? "flex flex-col items-center px-2" : "px-4")}>
          {footerItems.map((item) => (
            <RailLink
              key={item.id}
              item={item}
              active={isNavItemActive(pathname, item.href)}
              badge={navBadges[item.id]}
              collapsed={collapsed}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

/**
 * Collapse/expand control (client request, 2026-08-11: "Option for the Left
 * side bar to minimis/maximize… also the tables should be adjusted according to
 * screen size").
 *
 * The rail is 236px of a 1280px laptop — nearly a fifth of the screen, spent on
 * navigation, while the Inventory grid two panels over was being cut off at the
 * right edge. Collapsing hands 168px of that straight back to the table.
 */
function RailToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="grid size-[30px] flex-none place-items-center rounded-lg text-smoke transition-colors hover:bg-surface-raised hover:text-snow"
    >
      <svg viewBox="0 0 20 20" fill="none" className="size-[18px]" aria-hidden>
        <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d={collapsed ? "M8 3.5v13" : "M8 3.5v13"} stroke="currentColor" strokeWidth="1.4" />
        <path
          d={collapsed ? "M11.5 8.2l2.2 1.8-2.2 1.8" : "M14 8.2L11.8 10l2.2 1.8"}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function RailLink({
  item,
  active,
  badge = false,
  collapsed = false,
}: {
  item: NavItem;
  active: boolean;
  badge?: boolean;
  collapsed?: boolean;
}) {
  const Icon = NAV_ICONS[item.id];
  const accent = NAV_GROUP_ACCENT[item.group];
  return (
    <Link
      href={item.href}
      // The label is the only thing naming a collapsed icon, so it moves to the
      // tooltip rather than disappearing.
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        // Bigger + darker than before (owner: labels/icons read too small and grey).
        "relative flex items-center rounded-full text-[15px] font-medium transition-colors",
        collapsed ? "size-11 justify-center" : "gap-3 px-3 py-[9px]",
        active ? "bg-surface-raised text-snow" : "text-silver-mist hover:bg-surface-raised hover:text-snow",
      )}
    >
      {/* Active left bar in the section's hue — the primary wayfinding mark. */}
      {!collapsed && (
        <span
          aria-hidden
          className={cn(
            "absolute top-[7px] bottom-[7px] left-[-16px] w-[3px] rounded-r-full",
            active ? accent.bg : "bg-transparent",
          )}
        />
      )}
      <span
        aria-hidden
        className={cn("relative size-[20px] flex-none [&_svg]:size-full", active ? accent.text : "text-smoke")}
      >
        {Icon ? <Icon /> : null}
        {/* Attention dot — something in this section needs a decision. */}
        {badge && (
          <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-canvas bg-smark-orange-soft" />
        )}
      </span>
      {!collapsed && item.label}
      {!collapsed && <NavLinkPending spinner />}
    </Link>
  );
}
