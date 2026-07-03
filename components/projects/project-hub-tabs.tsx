"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface HubTab {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

export interface ProjectHubTabsProps {
  projectId: string;
  openTaskCount: number;
}

/**
 * Project-hub section nav (plan/tab-orders-projects.md R2-03 hub layout):
 * Overview · BOMs (bom-pipeline's own segment — this package only links to
 * it, per docs/OWNERSHIP.md) · Team & hours · Documents · Notes & tasks
 * (open-task badge, R2-06).
 */
export function ProjectHubTabs({ projectId, openTaskCount }: ProjectHubTabsProps) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  const tabs: HubTab[] = [
    { id: "overview", label: "Overview", href: base },
    { id: "boms", label: "BOMs", href: `${base}/boms` },
    { id: "team", label: "Team & hours", href: `${base}/team` },
    { id: "documents", label: "Documents", href: `${base}/documents` },
    { id: "notes", label: "Notes & tasks", href: `${base}/notes`, badge: openTaskCount },
  ];

  return (
    <div role="tablist" aria-label="Project sections" className="flex gap-1 overflow-x-auto border-b border-charcoal">
      {tabs.map((tab) => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(`${tab.href}`);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex flex-none items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] whitespace-nowrap transition-colors",
              active ? "border-smark-orange text-snow" : "border-transparent text-smoke hover:text-snow",
            )}
          >
            {tab.label}
            {!!tab.badge && tab.badge > 0 && (
              <span className="rounded-full bg-smark-orange px-1.5 py-0.5 font-mono text-[10px] text-obsidian">
                {tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
