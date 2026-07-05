"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatTime } from "@/lib/format";
import { StatusBadge } from "./status-badge";
import { OwnerCorrectionDrawer } from "./owner-correction-drawer";
import type { DayBreakdownEntry } from "@/lib/attendance/queries";

export interface AttendanceTimesByUser {
  checkIn: string | null;
  checkOut: string | null;
}

export interface DayBreakdownPanelProps {
  workDate: string;
  entries: readonly DayBreakdownEntry[];
  attendanceByUser: ReadonlyMap<string, AttendanceTimesByUser>;
  canManage: boolean;
  /** Employee view — only the caller's own row is in `entries`; suppresses the "who else" framing. */
  selfOnly?: boolean;
}

/**
 * "Click a date → who was Present/Absent/Leave/Holiday that day" (prompt's
 * Calendar bullet). Owner/accountant get every active user; employee gets
 * just their own row (page.tsx already scoped `entries` per dataScope).
 */
export function DayBreakdownPanel({ workDate, entries, attendanceByUser, canManage, selfOnly = false }: DayBreakdownPanelProps) {
  const [managing, setManaging] = useState<{ userId: string; userName: string } | null>(null);

  return (
    <Card padding="none">
      <CardHeader title={selfOnly ? "Your day" : "Who was in"} meta={formatDate(workDate)} />
      <div className="px-5 py-[18px]">
        {entries.length === 0 ? (
          <EmptyState tone="subtle" title="No one to show" />
        ) : (
          <TableShell minWidth={selfOnly ? 320 : 460}>
            <TableHead>
              <Tr>
                <Th>Person</Th>
                <Th>Status</Th>
                <Th>In / out</Th>
                {canManage && <Th align="right">Manage</Th>}
              </Tr>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const times = attendanceByUser.get(entry.user.id);
                return (
                  <Tr key={entry.user.id}>
                    <Td>{entry.user.displayName ?? entry.user.username}</Td>
                    <Td>
                      <StatusBadge status={entry.status} holidayName={entry.holidayName} leaveReason={entry.leaveReason} />
                    </Td>
                    <Td mono>
                      {times?.checkIn ? formatTime(times.checkIn) : "—"} – {times?.checkOut ? formatTime(times.checkOut) : "—"}
                    </Td>
                    {canManage && (
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setManaging({ userId: entry.user.id, userName: entry.user.displayName ?? entry.user.username })
                          }
                        >
                          Correct
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

      {managing && (
        <OwnerCorrectionDrawer
          open
          onClose={() => setManaging(null)}
          targetUserId={managing.userId}
          targetUserName={managing.userName}
          workDate={workDate}
          currentCheckIn={attendanceByUser.get(managing.userId)?.checkIn}
          currentCheckOut={attendanceByUser.get(managing.userId)?.checkOut}
        />
      )}
    </Card>
  );
}
