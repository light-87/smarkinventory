import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite, dataScope, isOwner } from "@/lib/auth/roles";
import { effectiveCanSee } from "@/lib/rbac/access";
import { getActiveUsers, getAttendanceForDay, getAttendanceForUserDay, getMyProjectOptions } from "@/lib/daily/queries";
import {
  getCompBalance,
  getCompWork,
  getHolidays,
  getLeaveRequests,
  getMonthBreakdown,
  getMonthCalendar,
  getOvertime,
  type AppUserBasic,
  type DayBreakdownEntry,
} from "@/lib/attendance/queries";
import { findHolidayForDate, monthRange, resolveDayStatus } from "@/lib/attendance/status";
import { istDateOnly } from "@/lib/timezone";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { CalendarView } from "@/components/attendance/calendar-view";
import { DayBreakdownPanel, type AttendanceTimesByUser } from "@/components/attendance/day-breakdown-panel";
import { MarkPresentCard } from "@/components/attendance/mark-present-card";
import { LeaveRequestsCard } from "@/components/attendance/leave-requests-card";
import { ApprovalsInboxCard } from "@/components/attendance/approvals-inbox-card";
import { HolidayAdminCard } from "@/components/attendance/holiday-admin-card";
import { AttendanceViewSwitch, type AttendanceView, type AttendanceViewOption } from "@/components/attendance/attendance-view-switch";
import { NativeSelect } from "@/components/attendance/native-select";

export const metadata: Metadata = { title: "Attendance" };

interface Section<T> {
  data: T | null;
  error: string | null;
}

async function loadSection<T>(promise: Promise<T>): Promise<Section<T>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function isValidDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Sign in to view Attendance." />
      </div>
    );
  }
  if (!effectiveCanSee(user.role, "attendance", user.grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Your account doesn't have access to Attendance." />
      </div>
    );
  }

  const todayDate = istDateOnly();
  const params = await searchParams;
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = rawMonth && isValidMonth(rawMonth) ? rawMonth : todayDate.slice(0, 7);
  const rawDay = Array.isArray(params.day) ? params.day[0] : params.day;
  const selectedDay = rawDay && isValidDateOnly(rawDay) ? rawDay : todayDate;

  const scope = dataScope(user.role, "attendance"); // "self" (employee) | "all" (owner/accountant)
  const canWriteSelf = canWrite(user.role, "attendance");
  const ownerRole = isOwner(user.role);
  const showAll = scope === "all";

  const rawViewingUser = Array.isArray(params.user) ? params.user[0] : params.user;
  const viewingUserId = showAll && rawViewingUser ? rawViewingUser : user.id;

  const supabase = await createClient();
  const { from, to } = monthRange(month);

  const [usersSection, holidaysSection, myLeaveSection, myCompSection, monthCalendarSection, dayAttendanceSection] = await Promise.all([
    showAll ? loadSection(getActiveUsers(supabase)) : loadSection(Promise.resolve([])),
    loadSection(getHolidays(supabase)),
    loadSection(getLeaveRequests(supabase, user.id)),
    loadSection(getCompWork(supabase, user.id)),
    loadSection(getMonthCalendar(supabase, viewingUserId, month, todayDate)),
    loadSection(getAttendanceForDay(supabase, selectedDay)),
  ]);

  const activeUsers = usersSection.data ?? [];
  const holidays = holidaysSection.data ?? [];
  const myLeaveRequests = myLeaveSection.data ?? [];
  const myCompWork = myCompSection.data ?? [];
  const monthCalendar = monthCalendarSection.data ?? [];

  const compBalance = await loadSection(getCompBalance(supabase, user.id)).then((s) => s.data ?? 0);
  const myProjectOptionsSection = canWriteSelf ? await loadSection(getMyProjectOptions(supabase, user.id)) : { data: [], error: null };
  const myProjectOptions = myProjectOptionsSection.data ?? [];

  const attendanceByUser = new Map<string, AttendanceTimesByUser>(
    (dayAttendanceSection.data ?? []).map((a) => [a.userId, { checkIn: a.checkIn, checkOut: a.checkOut }]),
  );

  // Today's derived status, for self — used by the mark-present card.
  const holidayInputs = holidays.map((h) => ({ kind: h.kind, holidayDate: h.holidayDate, weekday: h.weekday, name: h.name }));
  const myApprovedLeaves = myLeaveRequests
    .filter((l) => l.status === "approved")
    .map((l) => ({ startDate: l.startDate, endDate: l.endDate, reason: l.reason }));
  const myTodayAttendanceSection = await loadSection(getAttendanceForUserDay(supabase, user.id, todayDate));
  const iAmPresentToday = myTodayAttendanceSection.data !== null && myTodayAttendanceSection.data?.checkIn != null;
  const hasCheckedOutToday = myTodayAttendanceSection.data?.checkOut != null;

  // (0018) My overtime — today's claim drives the mark-out card's status chip.
  const myOvertime = await loadSection(getOvertime(supabase, user.id)).then((s) => s.data ?? []);
  const myOvertimeToday = myOvertime.find((o) => o.workDate === todayDate) ?? null;
  const overtimeToday = myOvertimeToday
    ? { hours: myOvertimeToday.hoursApproved ?? myOvertimeToday.hoursClaimed, status: myOvertimeToday.status }
    : null;
  const todayStatusResult = resolveDayStatus({
    date: todayDate,
    todayDate,
    hasAttendanceRow: iAmPresentToday,
    holidays: holidayInputs,
    approvedLeaves: myApprovedLeaves,
  });
  const isTodayHoliday = findHolidayForDate(todayDate, holidayInputs) !== null;
  const hasPendingOrApprovedCompClaimToday = myCompWork.some((c) => c.workDate === todayDate && c.status !== "rejected");

  // Day-breakdown panel for the selected day.
  let breakdownEntries: DayBreakdownEntry[] = [];
  if (showAll) {
    const usersBasic: AppUserBasic[] = activeUsers.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName }));
    const monthBreakdownSection = await loadSection(getMonthBreakdown(supabase, from, to, todayDate, usersBasic));
    breakdownEntries = (monthBreakdownSection.data ?? []).find((d) => d.date === selectedDay)?.entries ?? [];
  } else {
    const selfEntry = monthCalendar.find((d) => d.date === selectedDay);
    if (selfEntry) {
      breakdownEntries = [
        {
          user: { id: user.id, username: user.username, displayName: user.displayName },
          status: selfEntry.status,
          holidayName: selfEntry.holidayName,
          leaveReason: selfEntry.leaveReason,
        },
      ];
    }
  }

  const nameById = new Map<string, string>(activeUsers.map((u) => [u.id, u.displayName ?? u.username]));

  let ownerPendingLeaves: Awaited<ReturnType<typeof getLeaveRequests>> = [];
  let ownerPendingComp: Awaited<ReturnType<typeof getCompWork>> = [];
  let ownerPendingOvertime: Awaited<ReturnType<typeof getOvertime>> = [];
  const ownerCompBalanceByUser = new Map<string, number>();
  if (ownerRole) {
    const [allLeaves, allComp, allOvertime] = await Promise.all([
      loadSection(getLeaveRequests(supabase, null, { status: "pending" })),
      loadSection(getCompWork(supabase, null, { status: "pending" })),
      loadSection(getOvertime(supabase, null, { status: "pending" })),
    ]);
    ownerPendingLeaves = allLeaves.data ?? [];
    ownerPendingComp = allComp.data ?? [];
    ownerPendingOvertime = allOvertime.data ?? [];
    // Live comp-off balance (hours) for each employee with a pending comp-leave
    // request — so the owner sees how much they can deduct at approval.
    const compLeaveUserIds = Array.from(
      new Set(ownerPendingLeaves.filter((l) => l.reason === "compensatory").map((l) => l.userId)),
    );
    await Promise.all(
      compLeaveUserIds.map(async (uid) => {
        const bal = await loadSection(getCompBalance(supabase, uid)).then((s) => s.data ?? 0);
        ownerCompBalanceByUser.set(uid, bal);
      }),
    );
  }

  // Owner/accountant get a view switch (Team calendar · Approvals · Holidays · My leave)
  // so the page shows one focused view instead of 7 stacked sections. Employee keeps
  // its lean single scroll. Kept in `?view=` so calendar/picker nav preserves it.
  const viewOptions: AttendanceViewOption[] = showAll
    ? [
        { value: "team", label: "Team calendar" },
        ...(ownerRole
          ? ([
              { value: "approvals", label: "Approvals" },
              { value: "holidays", label: "Holidays" },
            ] as AttendanceViewOption[])
          : []),
        { value: "myleave", label: "My leave" },
      ]
    : [];
  const validViews = new Set(viewOptions.map((o) => o.value));
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: AttendanceView = rawView && validViews.has(rawView as AttendanceView) ? (rawView as AttendanceView) : "team";

  const calendarGrid = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
      <CalendarView
        month={month}
        calendar={monthCalendar}
        selectedDay={selectedDay}
        todayDate={todayDate}
        extraParams={showAll ? { user: viewingUserId, view } : {}}
        title={showAll && viewingUserId !== user.id ? `Calendar — ${nameById.get(viewingUserId) ?? "user"}` : "My calendar"}
      />
      <DayBreakdownPanel
        workDate={selectedDay}
        entries={breakdownEntries}
        attendanceByUser={attendanceByUser}
        canManage={ownerRole}
        selfOnly={!showAll}
      />
    </div>
  );

  const userPicker = showAll && activeUsers.length > 0 && (
    <Card>
      <form method="get" action="/attendance" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="day" value={selectedDay} />
        <input type="hidden" name="view" value={view} />
        <label className="text-[14px] text-smoke" htmlFor="attendance-user-select">
          Viewing calendar for
        </label>
        <NativeSelect
          id="attendance-user-select"
          name="user"
          defaultValue={viewingUserId}
          className="h-9 w-auto"
          options={[
            { value: user.id, label: "Me" },
            ...activeUsers.filter((u) => u.id !== user.id).map((u) => ({ value: u.id, label: u.displayName ?? u.username })),
          ]}
        />
      </form>
    </Card>
  );

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-1">
        <h1 className="text-heading-sm font-normal text-snow">Attendance</h1>
        <p className="text-[14px] text-smoke">Presence, holidays, leave and comp-work — nothing here is ever stored as &quot;absent&quot;.</p>
      </div>

      <MarkPresentCard
        todayDate={todayDate}
        status={todayStatusResult.status}
        holidayName={todayStatusResult.holidayName}
        canWriteSelf={canWriteSelf}
        isTodayHoliday={isTodayHoliday}
        hasPendingOrApprovedCompClaimToday={hasPendingOrApprovedCompClaimToday}
        compBalance={compBalance}
        iAmPresentToday={iAmPresentToday}
        hasCheckedOutToday={hasCheckedOutToday}
        overtimeToday={overtimeToday}
        myProjectOptions={myProjectOptions}
      />

      {showAll ? (
        <>
          <AttendanceViewSwitch active={view} options={viewOptions} />

          {view === "team" && (
            <>
              {userPicker}
              {calendarGrid}
            </>
          )}

          {view === "approvals" && ownerRole && (
            <ApprovalsInboxCard
              pendingLeaves={ownerPendingLeaves}
              pendingCompWork={ownerPendingComp}
              pendingOvertime={ownerPendingOvertime}
              compBalanceByUser={ownerCompBalanceByUser}
              nameById={nameById}
            />
          )}

          {view === "holidays" && ownerRole && <HolidayAdminCard holidays={holidays} />}

          {view === "myleave" && (
            <LeaveRequestsCard myRequests={myLeaveRequests} compBalance={compBalance} canWrite={canWriteSelf} />
          )}
        </>
      ) : (
        <>
          {calendarGrid}
          <LeaveRequestsCard myRequests={myLeaveRequests} compBalance={compBalance} canWrite={canWriteSelf} />
        </>
      )}
    </div>
  );
}
