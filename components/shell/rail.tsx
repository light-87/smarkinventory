"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { canSee, type Role } from "@/lib/auth/roles";
import {
  NAV_GROUP_LABELS,
  NAV_ITEMS,
  RAIL_GROUP_ORDER,
  isNavItemActive,
  type NavItem,
} from "@/lib/nav";
import { NAV_ICONS } from "./icons";
import { NavLinkPending } from "./nav-link-pending";

/**
 * Desktop left rail (>=768px) — grouped Overview / Operate / Projects / Team,
 * footer AI Memory + Settings below a divider. Prototype visuals: 236px,
 * pill items, orange left tick + dark pill on the active row.
 */
export function Rail({ role, pathname }: { role: Role; pathname: string }) {
  const footerItems = NAV_ITEMS.filter((item) => item.group === "footer");

  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] flex-none flex-col border-r border-charcoal bg-obsidian md:flex">
      <div className="flex items-center gap-[11px] border-b border-border-faint px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image benefit */}
        <img src="/brand/smark-mark.svg" alt="" className="h-[15px] w-auto flex-none" />
        <span className="text-[16px] font-medium text-snow">SmarkStock</span>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden py-3 pr-3 pl-4">
        {RAIL_GROUP_ORDER.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group && canSee(role, item.area));
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-1">
              <div className="px-2 pt-3.5 pb-1 text-[10px] tracking-[0.08em] text-faint uppercase">
                {NAV_GROUP_LABELS[group]}
              </div>
              {items.map((item) => (
                <RailLink key={item.id} item={item} active={isNavItemActive(pathname, item.href)} />
              ))}
            </div>
          );
        })}
      </nav>

      {footerItems.some((item) => canSee(role, item.area)) && (
        <div className="border-t border-border-faint px-4 py-3">
          {footerItems
            .filter((item) => canSee(role, item.area))
            .map((item) => (
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
