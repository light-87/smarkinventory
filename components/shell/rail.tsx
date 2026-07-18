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
}: {
  role: Role;
  pathname: string;
  grantedModules?: readonly Module[];
}) {
  const items = effectiveVisibleNavItems(role, grantedModules);
  const overviewItems = items.filter((item) => item.group === "overview");
  const footerItems = items.filter((item) => item.group === "footer");

  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] flex-none flex-col border-r border-charcoal bg-canvas md:flex">
      <div className="flex items-center gap-[11px] border-b border-border-faint px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image benefit */}
        <img src="/brand/smark-mark.svg" alt="" className="h-[15px] w-auto flex-none" />
        <span className="text-[17px] font-medium text-snow">SmarkStock</span>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden py-3 pr-3 pl-4">
        {overviewItems.map((item) => (
          <RailLink key={item.id} item={item} active={isNavItemActive(pathname, item.href)} />
        ))}

        {RAIL_GROUP_ORDER.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <div key={group} className="mb-1">
              <div
                className={cn(
                  "px-2 pt-3.5 pb-1 text-[12px] font-semibold tracking-[0.08em] uppercase",
                  NAV_GROUP_ACCENT[group].text,
                )}
              >
                {NAV_GROUP_LABELS[group]}
              </div>
              {groupItems.map((item) => (
                <RailLink key={item.id} item={item} active={isNavItemActive(pathname, item.href)} />
              ))}
            </div>
          );
        })}
      </nav>

      {footerItems.length > 0 && (
        <div className="border-t border-border-faint px-4 py-3">
          {footerItems.map((item) => (
            <RailLink key={item.id} item={item} active={isNavItemActive(pathname, item.href)} />
          ))}
        </div>
      )}
    </aside>
  );
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = NAV_ICONS[item.id];
  const accent = NAV_GROUP_ACCENT[item.group];
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-3 rounded-full px-3 py-[9px] text-sm transition-colors",
        active ? "bg-surface-raised font-medium text-snow" : "text-smoke hover:bg-surface-raised hover:text-snow",
      )}
    >
      {/* Active left bar in the section's hue — the primary wayfinding mark. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-[7px] bottom-[7px] left-[-16px] w-[3px] rounded-r-full",
          active ? accent.bg : "bg-transparent",
        )}
      />
      <span
        aria-hidden
        className={cn("size-[18px] flex-none [&_svg]:size-full", active ? accent.text : "text-graphite")}
      >
        {Icon ? <Icon /> : null}
      </span>
      {item.label}
      <NavLinkPending spinner />
    </Link>
  );
}
