"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/lib/format";
import { formatInOutRange, sumHours } from "@/lib/daily/compute";
import { clockInAction, clockOutAction, setWorkingOnAction } from "@/lib/daily/actions";
import type { AppUserOption, AttendanceView, ProjectOption, TimeEntryView } from "@/lib/daily/queries";
import { PersonDayModal } from "./log-hours-modal";

export interface TeamRow {
  user: AppUserOption;
  attendance: AttendanceView | null;
  hours: TimeEntryView[];
}

export interface AttendanceSectionProps {
  sessionUserId: string;
  sessionUserName: string;
  viewedDate: string;
  isToday: boolean;
  canWriteSelf: boolean;
  isOwner: boolean;
  myAttendance: AttendanceView | null;
  myHours: TimeEntryView[];
  myProjectOptions: ProjectOption[];
  showTeamTable: boolean;
  team: TeamRow[];
  allProjectOptions: ProjectOption[];
}

/**
 * Section 1 — Attendance & work (FEATURES.md §5.13). "My row" = the signed-in
 * user's own clock-in/out + working-on tag (owner/employee only — accountant
 * can't write attendance, RLS-mirrored in lib/auth/roles.ts). Team table =
 * owner (all people) / accountant (read all); owner additionally gets a
 * per-row "Manage" action to correct/backfill anyone's day.
 */
export function AttendanceSection({
  sessionUserId,
  sessionUserName,
  viewedDate,
  isToday,
  canWriteSelf,
  isOwner,
  myAttendance,
  myHours,
  myProjectOptions,
  showTeamTable,
  team,
  allProjectOptions,
}: AttendanceSectionProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [workingOn, setWorkingOnLocal] = useState(myAttendance?.currentProjectId ?? "");

  const [modal, setModal] = useState<{
    targetUserId: string;
    targetUserName: string;
    mode: "self-hours" | "owner-day";
    entries: TimeEntryView[];
    checkIn?: string | null;
    checkOut?: string | null;
    projectId?: string | null;
  } | null>(null);

  function handleClockIn() {
    startTransition(async () => {
      const result = await clockInAction({ projectId: workingOn || null });
      if (result.ok) {
        push({ msg: "Clocked in." });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function handleClockOut() {
    startTransition(async () => {
      const result = await clockOutAction();
      if (!result.ok) {
        push({ msg: result.error });
        return;
      }
      push({ msg: "Clocked out." });
      router.refresh();
      if (!result.hasLoggedHours) {
        setModal({
          targetUserId: sessionUserId,
          targetUserName: sessionUserName,
          mode: "self-hours",
          entries: myHours,
        });
      }
    });
  }

  function handleWorkingOnChange(projectId: string) {
    setWorkingOnLocal(projectId);
    startTransition(async () => {
      const result = await setWorkingOnAction({ projectId: projectId || null });
      if (result.ok) router.refresh();
      else push({ msg: result.error });
    });
  }

  const myHoursTotal = sumHours(myHours);

  return (
    <Card padding="none">
      <CardHeader title="Attendance & work" />

      <div className="flex flex-col gap-4 px-5 py-[18px]">
        {canWriteSelf && (
          <Card tone="panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-[14px] text-snow">{sessionUserName}</span>
                <Chip tone={myAttendance?.checkIn ? "success" : "default"}>
                  {myAttendance?.checkIn ? "Present" : "Not clocked in"}
                </Chip>
                <Chip tone="neutral" mono>
                  {formatInOutRange(formatTime(myAttendance?.checkIn), formatTime(myAttendance?.checkOut))}
                </Chip>
              </div>

              {isToday ? (
                <div className="flex flex-wrap items-center gap-2">
                  {myProjectOptions.length > 0 && (!myAttendance?.checkIn || !myAttendance?.checkOut) && (
                    <select
                      value={workingOn}
                      onChange={(e) => handleWorkingOnChange(e.target.value)}
                      className="h-9 rounded-lg border border-charcoal bg-surface-well px-3 text-[14px] text-snow outline-none focus:border-smark-orange"
                      aria-label="Working on"
                    >
                      <option value="">No project</option>
                      {myProjectOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {!myAttendance?.checkIn && (
                    <Button size="sm" onClick={handleClockIn} loading={pending}>
                      Clock in
                    </Button>
                  )}
                  {myAttendance?.checkIn && !myAttendance?.checkOut && (
                    <Button size="sm" variant="outline" onClick={handleClockOut} loading={pending}>
                      Clock out
                    </Button>
                  )}
                  {myAttendance?.checkIn && myAttendance?.checkOut && (
                    <Chip tone="default">Day complete</Chip>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-faint pt-3">
              <span className="text-caption text-smoke">
                {myHoursTotal > 0 ? `${myHoursTotal}h logged` : "No hours logged for this day"}
                {myAttendance?.currentProjectName ? ` · working on ${myAttendance.currentProjectName}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setModal({
                    targetUserId: sessionUserId,
                    targetUserName: sessionUserName,
                    mode: "self-hours",
                    entries: myHours,
                  })
                }
              >
                + Log hours
              </Button>
            </div>
          </Card>
        )}

        {showTeamTable && (
          <div>
            <div className="mb-2.5 text-[14px] font-medium text-snow">Team — {team.length}</div>
            {team.length === 0 ? (
              <EmptyState tone="subtle" title="No active users" />
            ) : (
              <TableShell minWidth={560}>
                <TableHead>
                  <Tr>
                    <Th>Person</Th>
                    <Th>Present</Th>
                    <Th>In / out</Th>
                    <Th align="right">Hours</Th>
                    <Th>Project(s)</Th>
                    {isOwner && <Th align="right">Manage</Th>}
                  </Tr>
                </TableHead>
                <TableBody>
                  {team.map((row) => {
                    const projects = [...new Set(row.hours.map((h) => h.projectName))];
                    const projectLabel = row.attendance?.currentProjectName
                      ? row.attendance.currentProjectName
                      : projects.length > 0
                        ? projects.join(", ")
                        : "—";
                    return (
                      <Tr key={row.user.id}>
                        <Td>{row.user.displayName ?? row.user.username}</Td>
                        <Td>
                          <Chip tone={row.attendance?.checkIn ? "success" : "default"} size="sm">
                            {row.attendance?.checkIn ? "Present" : "Absent"}
                          </Chip>
                        </Td>
                        <Td mono>{formatInOutRange(formatTime(row.attendance?.checkIn), formatTime(row.attendance?.checkOut))}</Td>
                        <Td align="right" mono>
                          {sumHours(row.hours) || "—"}
                        </Td>
                        <Td className="truncate">{projectLabel}</Td>
                        {isOwner && (
                          <Td align="right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setModal({
                                  targetUserId: row.user.id,
                                  targetUserName: row.user.displayName ?? row.user.username,
                                  mode: "owner-day",
                                  entries: row.hours,
                                  checkIn: row.attendance?.checkIn,
                                  checkOut: row.attendance?.checkOut,
                                  projectId: row.attendance?.currentProjectId,
                                })
                              }
                            >
                              Manage
                            </Button>
                          </Td>
                        )}
                      </Tr>
                    );
                  })}
                </TableBody>
              </TableShell>
            )}
          </div>
        )}
      </div>

      {modal && (
        <PersonDayModal
          open
          onClose={() => setModal(null)}
          mode={modal.mode}
          targetUserId={modal.targetUserId}
          targetUserName={modal.targetUserName}
          workDate={viewedDate}
          projectOptions={modal.mode === "owner-day" ? allProjectOptions : myProjectOptions}
          existingEntries={modal.entries}
          currentCheckIn={modal.checkIn}
          currentCheckOut={modal.checkOut}
          currentProjectId={modal.projectId}
        />
      )}
    </Card>
  );
}
