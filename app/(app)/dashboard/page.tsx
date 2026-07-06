import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardStats,
  getRecentAgentRuns,
  getRecentMovements,
  getUsageByProject,
} from "@/lib/dashboard/queries";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { getActiveUsers } from "@/lib/daily/queries";
import { getApprovedLeaveRequestsOverlapping, getHolidays, getUpcomingBirthdays } from "@/lib/attendance/queries";
import { datesInRange, findHolidayForDate } from "@/lib/attendance/status";
import { istDateOnly } from "@/lib/timezone";
import { getOldestOpenTasks } from "@/lib/pm/queries";
import { StatGrid } from "@/components/dashboard/stat-grid";
import { RecentMovementsCard } from "@/components/dashboard/recent-movements-card";
import { AgentActivityCard } from "@/components/dashboard/agent-activity-card";
import { UsageByProjectCard } from "@/components/dashboard/usage-by-project-card";
import { LeavesThisWeekCard } from "@/components/dashboard/leaves-this-week-card";
import { WeeklyHolidaysCard, type WeeklyHoliday } from "@/components/dashboard/weekly-holidays-card";
import { StaleTasksCard } from "@/components/dashboard/stale-tasks-card";
import { BirthdaysThisWeekCard } from "@/components/dashboard/birthdays-this-week-card";

export const metadata: Metadata = { title: "Dashboard" };

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

/** Owner-only sections skip the query ENTIRELY for other roles — `factory` is only invoked when `enabled` is true, never just hidden after fetching. */
async function ownerSection<T>(enabled: boolean, factory: () => Promise<T>): Promise<Section<T>> {
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

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  const owner = user !== null && isOwner(user.role);
  const todayDate = istDateOnly();
  const { from: weekFrom, to: weekEnd } = currentWeekBounds(todayDate);

  const [stats, movements, usage, agentRuns, leaves, holidaysSection, staleTasks, birthdays, activeUsersSection] = await Promise.all([
    loadSection(getDashboardStats(supabase)),
    loadSection(getRecentMovements(supabase)),
    loadSection(getUsageByProject(supabase)),
    loadSection(getRecentAgentRuns(supabase)),
    ownerSection(owner, () => getApprovedLeaveRequestsOverlapping(supabase, weekFrom, weekEnd)),
    ownerSection(owner, () => getHolidays(supabase, { from: weekFrom, to: weekEnd })),
    ownerSection(owner, () => getOldestOpenTasks(supabase, 5)),
    ownerSection(owner, () => getUpcomingBirthdays(supabase, weekFrom, weekEnd)),
    ownerSection(owner, () => getActiveUsers(supabase)),
  ]);

  const weeklyHolidays: WeeklyHoliday[] | null = holidaysSection.data
    ? datesInRange(weekFrom, weekEnd)
        .map((date) => {
          const holiday = findHolidayForDate(
            date,
            holidaysSection.data!.map((h) => ({ kind: h.kind, holidayDate: h.holidayDate, weekday: h.weekday, name: h.name })),
          );
          return holiday ? { date, name: holiday.name } : null;
        })
        .filter((h): h is WeeklyHoliday => h !== null)
    : null;

  const nameById = new Map<string, string>(
    (activeUsersSection.data ?? []).map((u) => [u.id, u.displayName ?? u.username]),
  );

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-6 sm:mb-[26px]">
        <StatGrid stats={stats.data} error={stats.error} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr]">
        <RecentMovementsCard movements={movements.data} error={movements.error} />
        <div className="flex flex-col gap-4">
          <AgentActivityCard initialRuns={agentRuns.data} error={agentRuns.error} />
          <UsageByProjectCard bars={usage.data} error={usage.error} />
        </div>
      </div>

      {owner && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <LeavesThisWeekCard leaves={leaves.data} error={leaves.error} nameById={nameById} />
          <WeeklyHolidaysCard holidays={weeklyHolidays} error={holidaysSection.error} />
          <StaleTasksCard tasks={staleTasks.data} error={staleTasks.error} />
          <BirthdaysThisWeekCard birthdays={birthdays.data} error={birthdays.error} />
        </div>
      )}
    </div>
  );
}
