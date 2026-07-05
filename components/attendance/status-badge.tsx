import { cn } from "@/lib/cn";
import type { AttendanceStatus } from "@/lib/attendance/status";
import type { LeaveReason } from "@/types/db";

/**
 * components/attendance/status-badge.tsx — the one place every attendance
 * surface (calendar grid, day breakdown, requests list) maps a derived
 * `AttendanceStatus` to a color + label. The design system reserves colour
 * for meaning (green = good, orange = the one warning voice) — see
 * app/globals.css header — so this mapping is deliberately restrained:
 * present/compensatory both read as "green" (comp still means they showed
 * up), absent is the one thing that gets the orange alert voice, everything
 * else stays a quiet neutral.
 */

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  compensatory: "Comp",
  holiday: "Holiday",
  leave: "Leave",
  absent: "Absent",
  not_marked: "Not marked",
};

const CELL_CLASSES: Record<AttendanceStatus, string> = {
  present: "border-forest-depth bg-forest-depth/25 text-phosphor-green",
  compensatory: "border-forest-depth bg-forest-depth/25 text-phosphor-green",
  holiday: "border-charcoal bg-ash text-smoke",
  leave: "border-smark-orange-soft/60 bg-surface-accent text-smark-orange-soft",
  absent: "border-smark-orange bg-surface-accent text-smark-orange",
  not_marked: "border-charcoal bg-surface-well text-faint",
};

const BADGE_CLASSES: Record<AttendanceStatus, string> = {
  present: "border-forest-depth text-phosphor-green",
  compensatory: "border-forest-depth text-phosphor-green",
  holiday: "border-charcoal text-smoke",
  leave: "border-smark-orange-soft/60 text-smark-orange-soft",
  absent: "border-smark-orange text-smark-orange",
  not_marked: "border-charcoal text-faint",
};

export function statusLabel(status: AttendanceStatus, holidayName?: string | null, leaveReason?: LeaveReason | null): string {
  if (status === "holiday" && holidayName) return holidayName;
  if (status === "compensatory" && holidayName) return `Comp · ${holidayName}`;
  if (status === "leave" && leaveReason) return `Leave · ${leaveReason}`;
  return STATUS_LABELS[status];
}

export function statusCellClasses(status: AttendanceStatus): string {
  return CELL_CLASSES[status];
}

export interface StatusBadgeProps {
  status: AttendanceStatus;
  holidayName?: string | null;
  leaveReason?: LeaveReason | null;
  className?: string;
}

/** Pill badge for list rows (requests inbox, day breakdown list). */
export function StatusBadge({ status, holidayName, leaveReason, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-[11px] py-[3px] text-xs whitespace-nowrap",
        BADGE_CLASSES[status],
        className,
      )}
    >
      {statusLabel(status, holidayName, leaveReason)}
    </span>
  );
}
