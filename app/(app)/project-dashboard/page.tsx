import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { istDateOnly } from "@/lib/timezone";
import { shiftDateOnly } from "@/lib/attendance/status";
import {
  deriveBugBandDistribution,
  deriveEmployeeKpiRows,
  deriveHoursBreakdown,
  deriveOverruns,
  deriveProjectRows,
  deriveStatTiles,
  deriveTaskStatusDistribution,
  deriveTimeLogEntries,
  getDashboardFilterOptions,
  loadDashboardDataset,
  type DashboardFilters,
  type HoursGroupBy,
} from "@/lib/pm/dashboard";
import { FilterBar } from "@/components/project-dashboard/filter-bar";
import { StatTiles } from "@/components/project-dashboard/stat-tiles";
import { ProjectsTable } from "@/components/project-dashboard/projects-table";
import { EmployeeKpiPanel } from "@/components/project-dashboard/employee-kpi-panel";
import { HoursBreakdownChart } from "@/components/project-dashboard/hours-breakdown-chart";
import { TaskBugDistribution } from "@/components/project-dashboard/task-bug-distribution";
import { EntriesFeed } from "@/components/project-dashboard/entries-feed";
import { OverrunsList } from "@/components/project-dashboard/overruns-list";

export const metadata: Metadata = { title: "Project Dashboard" };

const ENTRIES_PAGE_SIZE = 25;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isValidDateOnly(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * `/project-dashboard` — owner-only PM analytics (area "project_dashboard" in
 * lib/auth/roles.ts, hidden entirely for employee/accountant — canSee()
 * returns false for both, and lib/nav.ts's entry is filtered out of every
 * non-owner's nav automatically). Direct-URL access by another role 404s,
 * same guard pattern as app/(app)/settings/employees/page.tsx.
 */
export default async function ProjectDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user || !isOwner(user.role)) notFound();

  const params = await searchParams;
  const todayDate = istDateOnly();
  const defaultFrom = shiftDateOnly(todayDate, -29); // last 30 days (inclusive) by default

  const rawFrom = firstOf(params.from);
  const rawTo = firstOf(params.to);
  const filters: DashboardFilters = {
    from: isValidDateOnly(rawFrom) ? rawFrom : defaultFrom,
    to: isValidDateOnly(rawTo) ? rawTo : todayDate,
    client: firstOf(params.client) || null,
    projectId: firstOf(params.project) || null,
    employeeId: firstOf(params.employee) || null,
  };

  const rawGroup = firstOf(params.group);
  const groupBy: HoursGroupBy = rawGroup === "employee" || rawGroup === "client" ? rawGroup : "project";

  const rawEntriesPage = Number(firstOf(params.entriesPage));
  const entriesPage = Number.isInteger(rawEntriesPage) && rawEntriesPage > 0 ? rawEntriesPage : 1;

  const supabase = await createClient();
  const [filterOptions, dataset] = await Promise.all([
    getDashboardFilterOptions(supabase),
    loadDashboardDataset(supabase, filters),
  ]);

  const statTiles = deriveStatTiles(dataset);
  const projectRows = deriveProjectRows(dataset);
  const employeeRows = deriveEmployeeKpiRows(dataset);
  const hoursBuckets = deriveHoursBreakdown(dataset, groupBy);
  const taskStatusBuckets = deriveTaskStatusDistribution(dataset);
  const bugBandBuckets = deriveBugBandDistribution(dataset);
  const entriesPageData = deriveTimeLogEntries(dataset, entriesPage, ENTRIES_PAGE_SIZE);
  const overruns = deriveOverruns(dataset);

  // Carried on every Link/pagination control so toggling group-by or paging never drops the active filters.
  const baseParams: Record<string, string> = {
    from: filters.from ?? "",
    to: filters.to ?? "",
    client: filters.client ?? "",
    project: filters.projectId ?? "",
    employee: filters.employeeId ?? "",
  };

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-1">
        <h1 className="text-heading-sm font-normal text-snow">Project Dashboard</h1>
        <p className="text-[13px] text-smoke">Owner-only PM analytics — filter by date range, client, project, and employee.</p>
      </div>

      <FilterBar filters={filters} options={filterOptions} />

      <StatTiles stats={statTiles} />

      <ProjectsTable rows={projectRows} />

      <EmployeeKpiPanel rows={employeeRows} focusedUserId={filters.employeeId} />

      <HoursBreakdownChart buckets={hoursBuckets} groupBy={groupBy} baseParams={baseParams} />

      <TaskBugDistribution taskStatus={taskStatusBuckets} bugBands={bugBandBuckets} />

      <EntriesFeed
        page={entriesPageData}
        currentPage={entriesPage}
        pageSize={ENTRIES_PAGE_SIZE}
        baseParams={{ ...baseParams, group: groupBy }}
      />

      <OverrunsList rows={overruns} />
    </div>
  );
}
