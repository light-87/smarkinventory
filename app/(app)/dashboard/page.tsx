import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { getActiveUsers } from "@/lib/daily/queries";
import { getApprovedLeaveRequestsOverlapping, getHolidays, getUpcomingBirthdays } from "@/lib/attendance/queries";
import { shiftDateOnly } from "@/lib/attendance/status";
import { istDateOnly } from "@/lib/timezone";
import { getMyTasks, getOldestOpenTasks, listProjectsForEmployee } from "@/lib/pm/queries";
import { deriveEmployeeKpiRows, deriveOverruns, deriveProjectRows, loadDashboardDataset } from "@/lib/pm/dashboard";
import { effectiveVisibleNavItems, RAIL_GROUP_ORDER, NAV_GROUP_LABELS } from "@/lib/nav";
import { NavLauncher, type LauncherBox } from "@/components/dashboard/nav-launcher";
import { LeavesThisWeekCard } from "@/components/dashboard/leaves-this-week-card";
import { UpcomingHolidaysCard, type UpcomingHoliday } from "@/components/dashboard/upcoming-holidays-card";
import { StaleTasksCard } from "@/components/dashboard/stale-tasks-card";
import { BirthdaysThisWeekCard } from "@/components/dashboard/birthdays-this-week-card";
import { MyOpenTasksCard } from "@/components/dashboard/my-open-tasks-card";
import { ProjectsTable } from "@/components/project-dashboard/projects-table";
import { EmployeeKpiPanel } from "@/components/project-dashboard/employee-kpi-panel";
import { OverrunsList } from "@/components/project-dashboard/overruns-list";

export const metadata: Metadata = { title: "Dashboard" };

/** How far ahead the holidays card looks. Long enough that a holiday added a month out is visible the day it's added. */
const HOLIDAY_LOOKAHEAD_DAYS = 90;

/** Window the owner's project/employee rollups cover, matching /project-dashboard's own default. */
const PM_ROLLUP_DAYS = 29;

/** Most unfinished tasks an engineer sees on their dashboard before being sent to the full list. */
const MY_TASKS_LIMIT = 6;

interface Section<T> {
  data: T | null;
  error: string | null;
}

/** Each dashboard section fails independently — one bad query never blanks the whole page. */
async function loadSection<T>(promise: Promise<T>): Promise<Section<T>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

/** Role-gated sections skip the query ENTIRELY for other roles — `factory` is only invoked when `enabled` is true, never just hidden after fetching. */
async function gatedSection<T>(enabled: boolean, factory: () => Promise<T>): Promise<Section<T>> {
  if (!enabled) return { data: null, error: null };
  return loadSection(factory());
}

/** `{ from, to }` (YYYY-MM-DD, Monday-Sunday) for the week containing `todayDate` — no existing "current week" convention in the codebase (lib/attendance/status.ts only has month boundaries via monthRange), so Monday-start is chosen here as the common business-week default. Pure Date.UTC arithmetic, same style as lib/attendance/status.ts. */
function currentWeekBounds(todayDate: string): { from: string; to: string } {
  const [y, m, d] = todayDate.split("-").map(Number);
  const today = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const dayOfWeek = today.getUTCDay(); // 0 Sun .. 6 Sat
  const deltaToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today.getTime() + deltaToMonday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const fmt = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  return { from: fmt(monday), to: fmt(sunday) };
}

/**
 * The main dashboard — people and projects, not parts.
 *
 * The stock-side cards (units in stock, recent movements, agent activity,
 * per-project part usage) moved to `/inventory-dashboard`: the client asked
 * for an admin landing screen about the week and the work, not the warehouse.
 * What the owner gets instead is the week (holidays, leave, birthdays), the
 * oldest open tasks, and the project/employee rollups that previously lived
 * only on /project-dashboard.
 *
 * An engineer's version is the same shape minus the owner-scoped panels, plus
 * their own open tasks — otherwise removing the stock cards would have left
 * them with a nav launcher and a holiday list.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  const owner = user !== null && isOwner(user.role);
  const employee = user?.role === "employee";
  const todayDate = istDateOnly();
  const { from: weekFrom, to: weekEnd } = currentWeekBounds(todayDate);

  // Holidays are company-wide news, so this one is NOT role-gated (RLS has
  // always let every active role read smark_holidays) and it looks ahead
  // rather than at the current week — see UpcomingHolidaysCard's header.
  const holidayWindowEnd = shiftDateOnly(todayDate, HOLIDAY_LOOKAHEAD_DAYS);

  const [holidaysSection, leaves, staleTasks, birthdays, activeUsersSection, pmRollup, myTasks, myProjects] =
    await Promise.all([
      loadSection(getHolidays(supabase, { from: todayDate, to: holidayWindowEnd })),
      gatedSection(owner, () => getApprovedLeaveRequestsOverlapping(supabase, weekFrom, weekEnd)),
      gatedSection(owner, () => getOldestOpenTasks(supabase, 5)),
      gatedSection(owner, () => getUpcomingBirthdays(supabase, weekFrom, weekEnd)),
      gatedSection(owner, () => getActiveUsers(supabase)),
      gatedSection(owner, () =>
        loadDashboardDataset(supabase, {
          from: shiftDateOnly(todayDate, -PM_ROLLUP_DAYS),
          to: todayDate,
          client: null,
          projectId: null,
          employeeId: null,
        }),
      ),
      gatedSection(employee && user !== null, () => getMyTasks(supabase, user!.id)),
      gatedSection(employee && user !== null, () => listProjectsForEmployee(supabase, user!.id)),
    ]);

  const upcomingHolidays: UpcomingHoliday[] | null = holidaysSection.data
    ? holidaysSection.data
        .filter((h) => h.kind === "specific" && h.holidayDate !== null && h.holidayDate >= todayDate)
        .map((h) => ({ date: h.holidayDate as string, name: h.name }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 6)
    : null;

  const nameById = new Map<string, string>(
    (activeUsersSection.data ?? []).map((u) => [u.id, u.displayName ?? u.username]),
  );

  const projectRows = pmRollup.data ? deriveProjectRows(pmRollup.data) : null;
  const employeeRows = pmRollup.data ? deriveEmployeeKpiRows(pmRollup.data) : null;
  const overruns = pmRollup.data ? deriveOverruns(pmRollup.data) : null;

  const myOpenTasks = myTasks.data
    ? myTasks.data.filter((t) => t.status === "open" || t.status === "awaiting_client_input").slice(0, MY_TASKS_LIMIT)
    : null;
  const myProjectNameById = new Map<string, string>((myProjects.data ?? []).map((p) => [p.id, p.name]));

  // 4-box launcher (0013 nav categorization): one box per category the user
  // has at least one visible item in, linking to the FIRST such item (not a
  // hardcoded route) so it never points somewhere this user can't reach.
  const visibleItems = user ? effectiveVisibleNavItems(user.role, user.grantedModules) : [];
  const launcherBoxes: LauncherBox[] = RAIL_GROUP_ORDER.map((group) => {
    const first = visibleItems.find((item) => item.group === group);
    return first ? { iconId: first.id, label: NAV_GROUP_LABELS[group], href: first.href, group } : null;
  }).filter((box): box is LauncherBox => box !== null);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <NavLauncher boxes={launcherBoxes} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <UpcomingHolidaysCard holidays={upcomingHolidays} error={holidaysSection.error} />
        {employee && user && (
          <MyOpenTasksCard
            tasks={myOpenTasks}
            projectNameById={myProjectNameById}
            currentUserId={user.id}
            error={myTasks.error}
          />
        )}
        {owner && <LeavesThisWeekCard leaves={leaves.data} error={leaves.error} nameById={nameById} />}
        {owner && <StaleTasksCard tasks={staleTasks.data} error={staleTasks.error} />}
        {owner && <BirthdaysThisWeekCard birthdays={birthdays.data} error={birthdays.error} />}
      </div>

      {owner && (
        <div className="mt-4 flex flex-col gap-4">
          {pmRollup.error ? (
            <div className="text-body-sm text-smoke">{pmRollup.error}</div>
          ) : (
            <>
              {projectRows && <ProjectsTable rows={projectRows} />}
              {employeeRows && <EmployeeKpiPanel rows={employeeRows} focusedUserId={null} />}
              {overruns && <OverrunsList rows={overruns} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
