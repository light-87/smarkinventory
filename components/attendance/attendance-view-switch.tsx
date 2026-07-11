"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type AttendanceView = "team" | "approvals" | "holidays" | "myleave";

export interface AttendanceViewOption {
  value: AttendanceView;
  label: string;
}

/**
 * View switch for the owner/accountant attendance screen — separates "manage
 * everyone" (team calendar, approvals, holidays) from "my attendance" (leave),
 * so the page shows one focused view instead of 7 stacked sections. Kept in the
 * URL (`?view=`) so calendar day/month nav and the user picker preserve it.
 * Mirrors components/project-dashboard/dashboard-view-switch.tsx.
 */
export function AttendanceViewSwitch({
  active,
  options,
}: {
  active: AttendanceView;
  options: readonly AttendanceViewOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <SegmentedControl<AttendanceView>
      aria-label="Attendance view"
      options={options}
      value={active}
      onChange={change}
      className="self-start overflow-x-auto"
    />
  );
}
