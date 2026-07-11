"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface HubTab {
  id: string;
  label: string;
  href: string;
}

export interface ProjectHubTabsProps {
  projectId: string;
  /** Owner + accountant see the Manage tab (income + client sharing/visibility). */
  showManage?: boolean;
}

/** Project-hub section nav: Overview · BOMs (bom-pipeline's own segment, untouched) · Documents · Manage. */
export function ProjectHubTabs({ projectId, showManage = false }: ProjectHubTabsProps) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  const tabs: HubTab[] = [
    { id: "overview", label: "Overview", href: base },
    { id: "boms", label: "BOMs", href: `${base}/boms` },
    { id: "documents", label: "Documents", href: `${base}/documents` },
    ...(showManage ? [{ id: "manage", label: "Manage", href: `${base}/manage` }] : []),
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
              "flex flex-none items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[14px] whitespace-nowrap transition-colors",
              active ? "border-smark-orange text-snow" : "border-transparent text-smoke hover:text-snow",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
