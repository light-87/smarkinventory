/**
 * lib/projects/hours.ts — pure per-member hour rollups for the Team & hours
 * tab (FEATURES.md §5.8 R2-04: "hours table per member — hours this week /
 * total on this project"). Manual entries only (Q-03 final) — no timers.
 */

import { isValid, parseISO, startOfWeek } from "date-fns";

export interface TimeEntryLike {
  user_id: string;
  work_date: string;
  hours: number;
}

export interface MemberHoursSummary {
  userId: string;
  weekHours: number;
  totalHours: number;
}

/** Groups entries per member: total hours on the project + hours in the current ISO week (Mon–Sun). */
export function summarizeHoursByMember(
  entries: readonly TimeEntryLike[],
  referenceDate: Date = new Date(),
): Map<string, MemberHoursSummary> {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const byUser = new Map<string, MemberHoursSummary>();

  for (const entry of entries) {
    const current = byUser.get(entry.user_id) ?? { userId: entry.user_id, weekHours: 0, totalHours: 0 };
    current.totalHours += entry.hours;

    const workDate = parseISO(entry.work_date);
    if (isValid(workDate) && workDate >= weekStart) {
      current.weekHours += entry.hours;
    }
    byUser.set(entry.user_id, current);
  }

  return byUser;
}
