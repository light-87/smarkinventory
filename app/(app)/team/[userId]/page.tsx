import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { istDateOnly } from "@/lib/timezone";
import { formatDate } from "@/lib/format";
import {
  getCompBalance,
  getLeaveRequests,
  getMonthCalendar,
  getOvertime,
} from "@/lib/attendance/queries";
import { getMyTasks } from "@/lib/pm/queries";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarView } from "@/components/attendance/calendar-view";
import type { ApprovalStatus } from "@/types/db";

export const metadata: Metadata = { title: "Employee dashboard" };

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

const STATUS_TONE: Record<ApprovalStatus, ChipTone> = {
  pending: "warn",
  approved: "success",
  rejected: "danger",
};

const TASK_TONE: Record<string, ChipTone> = {
  open: "neutral",
  awaiting_client_input: "warn",
  submitted: "accent",
  done: "success",
};

/**
 * (0018) `/team/[userId]` — owner-only dashboard for one employee: attendance
 * calendar, comp-off HOURS balance + overtime history, leave requests, and
 * assigned tasks. Read-only composition over existing attendance + pm queries.
 */
export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user || !isOwner(user.role)) notFound();

  const { userId } = await params;
  const sp = await searchParams;
  const todayDate = istDateOnly();
  const rawMonth = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = rawMonth && isValidMonth(rawMonth) ? rawMonth : todayDate.slice(0, 7);
  const rawDay = Array.isArray(sp.day) ? sp.day[0] : sp.day;
  const selectedDay = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : todayDate;

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("smark_app_users")
    .select("id, username, display_name, active")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) notFound();

  const [calendar, compBalance, overtime, leaves, tasks] = await Promise.all([
    getMonthCalendar(supabase, userId, month, todayDate),
    getCompBalance(supabase, userId),
    getOvertime(supabase, userId),
    getLeaveRequests(supabase, userId),
    getMyTasks(supabase, userId),
  ]);

  const openTasks = tasks.filter((t) => t.status !== "done");

  // This-month attendance tally, derived from the same calendar the grid shows.
  // "compensatory" (worked a holiday) counts as a present day.
  const monthCounts = calendar.reduce<Record<string, number>>((acc, day) => {
    acc[day.status] = (acc[day.status] ?? 0) + 1;
    return acc;
  }, {});
  const presentDays = (monthCounts.present ?? 0) + (monthCounts.compensatory ?? 0);
  const absentDays = monthCounts.absent ?? 0;
  const leaveDays = monthCounts.leave ?? 0;
  const holidayDays = monthCounts.holiday ?? 0;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="text-caption text-smoke">
        <Link href="/team" className="hover:text-snow">
          ← Employees
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-heading-sm font-normal text-snow">{profile.display_name ?? profile.username}</h1>
          <p className="text-caption text-smoke">
            @{profile.username}
            {!profile.active ? " · archived" : ""}
          </p>
        </div>
        <Chip tone={compBalance > 0 ? "success" : "neutral"} mono>
          {compBalance > 0 ? "+" : ""}
          {compBalance}h comp-off banked
        </Chip>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard value={presentDays} label="Present this month" tone="success" />
        <StatCard value={absentDays} label="Absent" tone="danger" />
        <StatCard value={leaveDays} label="On leave" tone="warn" />
        <StatCard value={holidayDays} label="Holidays" tone="default" />
      </div>

      <CalendarView
        month={month}
        calendar={calendar}
        selectedDay={selectedDay}
        todayDate={todayDate}
        basePath={`/team/${userId}`}
        title="Attendance"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="none">
          <CardHeader title="Overtime" meta={overtime.length > 0 ? `${overtime.length}` : "none"} />
          <div className="flex flex-col gap-2 px-5 py-[18px]">
            {overtime.length === 0 ? (
              <EmptyState tone="subtle" title="No overtime logged" />
            ) : (
              overtime.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-charcoal px-3.5 py-2.5">
                  <div className="min-w-0 text-[15px] text-snow">
                    {formatDate(o.workDate)} ·{" "}
                    <span className="font-mono">
                      {o.status === "approved" && o.hoursApproved != null ? `${o.hoursApproved}h` : `${o.hoursClaimed}h`}
                    </span>
                    {o.note ? <span className="text-smoke"> · {o.note}</span> : ""}
                  </div>
                  <Chip tone={STATUS_TONE[o.status]} size="sm">
                    {o.status}
                  </Chip>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card padding="none">
          <CardHeader title="Leave" meta={leaves.length > 0 ? `${leaves.length}` : "none"} />
          <div className="flex flex-col gap-2 px-5 py-[18px]">
            {leaves.length === 0 ? (
              <EmptyState tone="subtle" title="No leave requests" />
            ) : (
              leaves.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-charcoal px-3.5 py-2.5">
                  <div className="min-w-0 text-[15px] text-snow">
                    {formatDate(l.startDate)}
                    {l.endDate !== l.startDate ? ` – ${formatDate(l.endDate)}` : ""} ·{" "}
                    <span className="text-smoke">{l.reason}</span>
                    {l.reason === "compensatory" && l.status === "approved" && l.compHours != null ? (
                      <span className="font-mono text-smoke"> · −{l.compHours}h</span>
                    ) : null}
                  </div>
                  <Chip tone={STATUS_TONE[l.status]} size="sm">
                    {l.status}
                  </Chip>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card padding="none">
        <CardHeader title="Assigned tasks" meta={`${openTasks.length} open · ${tasks.length} total`} />
        <div className="flex flex-col gap-2 px-5 py-[18px]">
          {tasks.length === 0 ? (
            <EmptyState tone="subtle" title="No tasks assigned" />
          ) : (
            tasks.map((t) => (
              <Link
                key={t.id}
                href={`/projects/${t.projectId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-charcoal px-3.5 py-2.5 transition-colors hover:bg-surface-hover"
              >
                <span className="min-w-0 truncate text-[15px] text-snow">{t.title}</span>
                <Chip tone={TASK_TONE[t.status] ?? "neutral"} size="sm">
                  {t.status.replace(/_/g, " ")}
                </Chip>
              </Link>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
