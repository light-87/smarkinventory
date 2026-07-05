"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { type Role } from "@/lib/auth/roles";
import { isNavItemActive, visibleMobilePrimaryItems } from "@/lib/nav";
import { MoreIcon, NAV_ICONS } from "./icons";
import { NavLinkPending } from "./nav-link-pending";

/**
 * Mobile bottom bar (<768px, R2-22): Dashboard · Inventory · Scan · Projects
 * · More. The 5th slot always opens the More sheet (never a route).
 */
export function BottomBar({
  role,
  pathname,
  onMore,
}: {
  role: Role;
  pathname: string;
  onMore: () => void;
}) {
  const items = visibleMobilePrimaryItems(role);

  return (
    // 60px of tab content ABOVE the safe-area inset. Putting the inset as
    // padding *inside* a fixed 60px height squished/clipped the icons+labels on
    // phones with a home indicator; growing the height by the inset keeps the
    // tap targets full-size and the inset padding sits over the indicator.
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-charcoal bg-obsidian/95 backdrop-blur md:hidden"
      style={{ height: "calc(60px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((item) => {
        const Icon = NAV_ICONS[item.id];
        const active = isNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "flex min-w-11 flex-1 flex-col items-center justify-center gap-[3px] text-[10px]",
              active ? "text-smark-orange" : "text-smoke",
            )}
          >
            <span aria-hidden className="size-5 [&_svg]:size-full">
              {Icon ? <Icon /> : null}
            </span>
            {item.label}
            <NavLinkPending />
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex min-w-11 flex-1 flex-col items-center justify-center gap-[3px] text-[10px] text-smoke"
      >
        <span aria-hidden className="size-5 [&_svg]:size-full">
          <MoreIcon />
        </span>
        More
      </button>
    </nav>
  );
}
