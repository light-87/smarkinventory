"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatNumber } from "@/lib/format";
import type { TimeEntryRow } from "@/types/db";
import type { AppUserOption, ProjectMemberWithUser } from "@/lib/projects/queries";
import { addTimeEntryAction } from "@/lib/projects/team-actions";
import { summarizeHoursByMember } from "@/lib/projects/hours";

export interface HoursTableProps {
  projectId: string;
  members: readonly ProjectMemberWithUser[];
  timeEntries: readonly TimeEntryRow[];
  currentUserId: string | null;
  /** The owner can log/correct anyone's hours (Q-03 final); everyone else logs only their own. */
  isOwner: boolean;
  canLog: boolean;
}

function displayNameFor(user: AppUserOption | null | undefined): string {
  if (!user) return "Unknown";
  return user.display_name ?? user.username;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Team & hours — per-member week/total hours from manual entries (Q-03 final), expandable to dated rows. */
export function HoursTable({ projectId, members, timeEntries, currentUserId, isOwner, canLog }: HoursTableProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logUserId, setLogUserId] = useState(currentUserId ?? "");
  const [workDate, setWorkDate] = useState(todayIso);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");

  const summary = useMemo(() => summarizeHoursByMember(timeEntries), [timeEntries]);

  const entriesByUser = useMemo(() => {
    const map = new Map<string, TimeEntryRow[]>();
    for (const entry of timeEntries) {
      const list = map.get(entry.user_id) ?? [];
      list.push(entry);
      map.set(entry.user_id, list);
    }
    return map;
  }, [timeEntries]);

  const userById = useMemo(
    () => new Map(members.map((m) => [m.membership.user_id, m.user] as const)),
    [members],
  );

  const rowUserIds = useMemo(() => {
    const ids = new Set(members.map((m) => m.membership.user_id));
    for (const entry of timeEntries) ids.add(entry.user_id);
    return Array.from(ids);
  }, [members, timeEntries]);

  const loggableUsers = members.map((m) => m.user).filter((u): u is AppUserOption => u != null);

  function submitEntry() {
    const parsedHours = Number.parseFloat(hours);
    const userId = isOwner ? logUserId : currentUserId;
    if (!userId) {
      push({ msg: "Pick who this is for" });
      return;
    }
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      push({ msg: "Enter hours greater than 0" });
      return;
    }
    startTransition(async () => {
      try {
        await addTimeEntryAction({ projectId, userId, workDate, hours: parsedHours, note: note || null });
        setHours("");
        setNote("");
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't log those hours." });
      }
    });
  }

  return (
    <Card padding="none">
      <div className="border-b border-border-divider px-5 py-4">
        <SectionLabel>Hours</SectionLabel>
      </div>

      {rowUserIds.length === 0 ? (
        <div className="px-5 py-6 text-center text-caption text-smoke">No hours logged yet.</div>
      ) : (
        <TableShell minWidth={480}>
          <TableHead>
            <Tr>
              <Th style={{ width: 24 }} />
              <Th>Member</Th>
              <Th align="right">This week</Th>
              <Th align="right">Total</Th>
            </Tr>
          </TableHead>
          <TableBody>
            {rowUserIds.map((userId) => {
              const user = userById.get(userId);
              const s = summary.get(userId);
              const isOpen = expanded === userId;
              return (
                <Fragment key={userId}>
                  <Tr interactive onClick={() => setExpanded(isOpen ? null : userId)}>
                    <Td className="text-smoke">{isOpen ? "▾" : "▸"}</Td>
                    <Td>{displayNameFor(user)}</Td>
                    <Td align="right" mono>
                      {formatNumber(s?.weekHours ?? 0, { decimals: 1 })}h
                    </Td>
                    <Td align="right" mono>
                      {formatNumber(s?.totalHours ?? 0, { decimals: 1 })}h
                    </Td>
                  </Tr>
                  {isOpen && (
                    <Tr>
                      <Td colSpan={4} className="bg-surface-well p-0">
                        <div className="flex flex-col gap-1 px-5 py-3">
                          {(entriesByUser.get(userId) ?? []).map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between gap-3 text-caption">
                              <span className="text-smoke">{formatDate(entry.work_date)}</span>
                              <span className="flex-1 truncate text-silver-mist">{entry.note}</span>
                              <span className="font-mono text-snow">{formatNumber(entry.hours, { decimals: 1 })}h</span>
                            </div>
                          ))}
                        </div>
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </TableShell>
      )}

      {canLog && (
        <div className="flex flex-col gap-2.5 border-t border-border-divider px-5 py-4">
          <SectionLabel>Log hours</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {isOwner ? (
              <select
                value={logUserId}
                onChange={(e) => setLogUserId(e.target.value)}
                className="h-11 rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none focus:border-smark-orange"
              >
                <option value="">Who?</option>
                {loggableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {displayNameFor(u)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center text-[13px] text-smoke">Yourself</div>
            )}
            <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            <Input
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              placeholder="Hours"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button size="sm" onClick={submitEntry} loading={isPending} className="self-start">
            Log
          </Button>
        </div>
      )}
    </Card>
  );
}
