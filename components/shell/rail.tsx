"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { type Role } from "@/lib/auth/roles";
import type { Module } from "@/lib/rbac/types";
import {
  NAV_GROUP_LABELS,
  RAIL_GROUP_ORDER,
  effectiveVisibleNavItems,
  isNavItemActive,
  type NavItem,
} from "@/lib/nav";
import { NAV_ICONS } from "./icons";
import { NavLinkPending } from "./nav-link-pending";

/**
 * Desktop left rail (>=768px) — Dashboard pinned at top (not collapsible),
 * then the 4 category headers (Inventory/Ordering/Team/Projects, 0013 nav
 * categorization) as collapsible sections — collapsed by default, click to
 * expand — then AI Memory + Settings below a divider. A role whose visible
 * items only populate 1-2 of the 4 categories simply never renders the
 * others (no forced empty headers). Visibility now runs through
 * `effectiveVisibleNavItems` (lib/nav.ts) — canSee() PLUS, for `employee`,
 * module grants (lib/rbac) — instead of the raw role-only `canSee`.
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
  const [openGroups, setOpenGroups] = useState<Partial<Record<(typeof RAIL_GROUP_ORDER)[number], boolean>>>({});

  const items = effectiveVisibleNavItems(role, grantedModules);
  const overviewItems = items.filter((item) => item.group === "overview");
  const footerItems = items.filter((item) => item.group === "footer");

  const toggleGroup = (group: (typeof RAIL_GROUP_ORDER)[number]) =>
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));

  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] flex-none flex-col border-r border-charcoal bg-canvas md:flex">
      <div className="flex items-center gap-[11px] border-b border-border-faint px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image benefit */}
        <img src="/brand/smark-mark.svg" alt="" className="h-[15px] w-auto flex-none" />
        <span className="text-[16px] font-medium text-snow">SmarkStock</span>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden py-3 pr-3 pl-4">
        {overviewItems.map((item) => (
          <RailLink key={item.id} item={item} active={isNavItemActive(pathname, item.href)} />
        ))}

        {RAIL_GROUP_ORDER.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          // A group containing the active route stays expanded regardless of
          // its collapsed state, so navigating deep-links in never hides the
          // page you're actually on behind a collapsed header.
          const hasActiveItem = groupItems.some((item) => isNavItemActive(pathname, item.href));
          const expanded = hasActiveItem || (openGroups[group] ?? false);

          return (
            <div key={group} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={expanded}
                className="flex w-full min-h-[28px] items-center justify-between gap-2 rounded-md px-2 pt-3.5 pb-1 text-[11px] tracking-[0.08em] text-faint uppercase transition-colors hover:text-smoke"
              >
                {NAV_GROUP_LABELS[group]}
                <span
                  aria-hidden
                  className={cn("text-[11px] transition-transform", expanded ? "rotate-90" : "rotate-0")}
                >
                  &rsaquo;
                </span>
              </button>
              {expanded &&
                groupItems.map((item) => (
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
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-3 rounded-full px-3 py-[9px] text-sm transition-colors",
        active ? "bg-surface-raised text-snow" : "text-smoke hover:bg-surface-raised hover:text-snow",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[7px] bottom-[7px] left-[-16px] w-0.5 rounded-r-full",
          active ? "bg-smark-orange" : "bg-transparent",
        )}
      />
      <span aria-hidden className="size-[18px] flex-none [&_svg]:size-full">
        {Icon ? <Icon /> : null}
      </span>
      {item.label}
      <NavLinkPending spinner />
    </Link>
  );
}
