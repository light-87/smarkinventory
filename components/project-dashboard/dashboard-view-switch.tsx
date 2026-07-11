"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type DashboardView = "overview" | "projects" | "employees" | "timelog";

const VIEW_OPTIONS = [
  { value: "overview", label: "Overview" },
  { value: "projects", label: "By project" },
  { value: "employees", label: "By employee" },
  { value: "timelog", label: "Time log" },
] as const;

/**
 * View switch for the Project Dashboard — turns the old 16-widget scroll into
 * four focused views. Kept in the URL (`?view=`) so entries-feed pagination
 * and shared links preserve the active view; switching resets `entriesPage`.
 */
export function DashboardViewSwitch({ active }: { active: DashboardView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.delete("entriesPage"); // a new view starts on page 1
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <SegmentedControl<DashboardView>
      aria-label="Dashboard view"
      options={VIEW_OPTIONS}
      value={active}
      onChange={change}
      className="self-start overflow-x-auto"
    />
  );
}
