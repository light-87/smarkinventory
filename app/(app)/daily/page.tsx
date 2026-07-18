import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canSee, canWrite, dataScope, isOwner } from "@/lib/auth/roles";
import {
  getActiveUsers,
  getAllActiveProjects,
  getAttendanceForDay,
  getHoursForDay,
  getMovementsForRange,
  getMyProjectOptions,
  getOrderingActivityForRange,
  getUserNames,
} from "@/lib/daily/queries";
import { dayToIsoBounds, isValidDateOnly, todayDateOnly } from "@/lib/daily/compute";
import { DayHeader } from "@/components/daily/day-header";
import { AttendanceSection, type TeamRow } from "@/components/daily/attendance-section";
import { MovementsCard } from "@/components/daily/movements-card";
import { OrderingActivityCard } from "@/components/daily/ordering-activity-card";
import { ExportPanel } from "@/components/daily/export-panel";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProjectOption } from "@/lib/daily/queries";

export const metadata: Metadata = { title: "Daily Reports" };

interface Section<T> {
  data: T | null;
  error: string | null;
}

/** Each section fails independently — one bad query never blanks the whole page (mirrors lib/dashboard's page.tsx). */
async function loadSection<T>(promise: Promise<T>): Promise<Section<T>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

export default async function DailyReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Sign in to view Daily Reports." />
      </div>
    );
  }
  if (!canSee(user.role, "daily_reports")) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Your account doesn't have access to Daily Reports." />
      </div>
    );
  }

  const params = await searchParams;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const viewedDate = rawDate && isValidDateOnly(rawDate) ? rawDate : todayDateOnly();
  const isToday = viewedDate === todayDateOnly();

  const scope = dataScope(user.role, "daily_reports"); // "self" (employee) | "all" (owner/accountant)
  const rawPerson = Array.isArray(params.person) ? params.person[0] : params.person;
  // Employee is ALWAYS forced to self, regardless of the query string — see
  // lib/daily/queries.ts header ("Employee sees self only" is enforced HERE).
  const personParam = scope === "self" ? "all" : (rawPerson ?? "all");
  const actorFilter: string | null = scope === "self" ? user.id : personParam === "all" ? null : personParam;

  const canWriteSelf = canWrite(user.role, "daily_reports");
  const showTeamTable = scope === "all";
  const bounds = dayToIsoBounds(viewedDate);

  const supabase = await createClient();

  const emptyProjects: Section<ProjectOption[]> = { data: [], error: null };

  const [peopleSection, myProjectsSection, allProjectsSection, attendanceSection, hoursSection, movementsSection, orderingSection] =
    await Promise.all([
      loadSection(getActiveUsers(supabase)),
      canWriteSelf ? loadSection(getMyProjectOptions(supabase, user.id)) : Promise.resolve(emptyProjects),
      isOwner(user.role) ? loadSection(getAllActiveProjects(supabase)) : Promise.resolve(emptyProjects),
      loadSection(getAttendanceForDay(supabase, viewedDate)),
      loadSection(getHoursForDay(supabase, viewedDate)),
      loadSection(getMovementsForRange(supabase, bounds, actorFilter)),
      loadSection(getOrderingActivityForRange(supabase, bounds, actorFilter)),
    ]);

  const people = peopleSection.data ?? [];
  const myProjectOptions = myProjectsSection.data ?? [];
  const allProjectOptions = allProjectsSection.data ?? [];
  const attendanceRows = attendanceSection.data ?? [];
  const hoursRows = hoursSection.data ?? [];

  const myAttendance = attendanceRows.find((a) => a.userId === user.id) ?? null;
  const myHours = hoursRows.filter((h) => h.userId === user.id);

  // Covers deactivated users too (getActiveUsers only lists active ones, but
  // a deactivated user's PAST movements/ordering activity still needs a real
  // name, not "Unknown") — a second small lookup rather than widening
  // getActiveUsers' own contract (team table / person-filter genuinely want
  // active-only).
  const movementActorIds = (movementsSection.data ?? []).map((m) => m.actorId);
  const orderingActorIds = (orderingSection.data ?? []).flatMap((o) => (o.actorId ? [o.actorId] : []));
  const nameByIdSection = await loadSection(
    getUserNames(supabase, [...people.map((p) => p.id), ...movementActorIds, ...orderingActorIds]),
  );
  const nameById = nameByIdSection.data ?? new Map(people.map((p) => [p.id, p.displayName ?? p.username]));

  let team: TeamRow[] = people.map((p) => ({
    user: p,
    attendance: attendanceRows.find((a) => a.userId === p.id) ?? null,
    hours: hoursRows.filter((h) => h.userId === p.id),
  }));
  if (personParam !== "all") team = team.filter((row) => row.user.id === personParam);

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-1">
        <h1 className="text-heading-sm font-normal text-snow">Daily Reports</h1>
        <p className="text-[15px] text-smoke">Who was in, what moved, and what happened on any given day.</p>
      </div>

      <DayHeader viewedDate={viewedDate} personParam={personParam} showPersonFilter={scope === "all"} people={people} />

      <AttendanceSection
        sessionUserId={user.id}
        sessionUserName={user.displayName ?? user.username}
        viewedDate={viewedDate}
        isToday={isToday}
        canWriteSelf={canWriteSelf}
        isOwner={isOwner(user.role)}
        myAttendance={myAttendance}
        myHours={myHours}
        myProjectOptions={myProjectOptions}
        showTeamTable={showTeamTable}
        team={team}
        allProjectOptions={allProjectOptions}
      />

      <MovementsCard rows={movementsSection.data} error={movementsSection.error} nameById={nameById} />
      <OrderingActivityCard items={orderingSection.data} error={orderingSection.error} nameById={nameById} />

      <ExportPanel defaultDate={viewedDate} personParam={personParam} />
    </div>
  );
}
