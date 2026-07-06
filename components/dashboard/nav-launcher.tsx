import Link from "next/link";
import { NAV_ICONS } from "@/components/shell/icons";

export interface LauncherBox {
  /** NAV_ICONS key of the first accessible item in this category — the box's icon. */
  iconId: string;
  label: string;
  href: string;
}

/**
 * 4-box quick launcher (0013 nav categorization) — Inventory / Ordering /
 * Team / Projects, each linking to the first nav item in that category the
 * current user can actually reach (app/(app)/dashboard/page.tsx works out
 * which item that is, respecting `effectiveVisibleNavItems`). Visually
 * secondary to the stat grid above it — quiet bordered tiles, not another
 * stat-card treatment. A role whose access only spans 1-2 categories simply
 * renders fewer boxes (never an empty/disabled one).
 */
export function NavLauncher({ boxes }: { boxes: LauncherBox[] }) {
  if (boxes.length === 0) return null;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-[26px] sm:grid-cols-4">
      {boxes.map((box) => {
        const Icon = NAV_ICONS[box.iconId];
        return (
          <Link
            key={box.label}
            href={box.href}
            className="flex min-h-11 flex-col items-center justify-center gap-2 rounded-2xl border border-charcoal bg-surface-panel px-3 py-4 text-center text-[13px] text-snow transition-colors hover:bg-surface-hover"
          >
            <span aria-hidden className="size-6 flex-none text-smark-orange [&_svg]:size-full">
              {Icon ? <Icon /> : null}
            </span>
            {box.label}
          </Link>
        );
      })}
    </div>
  );
}
