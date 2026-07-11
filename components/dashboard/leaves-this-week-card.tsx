import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import type { LeaveRequestView } from "@/lib/attendance/queries";

const REASON_LABEL: Record<LeaveRequestView["reason"], string> = {
  personal: "Personal",
  sick: "Sick",
  compensatory: "Compensatory",
};

export interface LeavesThisWeekCardProps {
  leaves: LeaveRequestView[] | null;
  error?: string | null;
  nameById: Map<string, string>;
}

/** Owner-only: approved leave requests overlapping the current Mon-Sun week (lib/attendance/queries.ts getApprovedLeaveRequestsOverlapping). */
export function LeavesThisWeekCard({ leaves, error, nameById }: LeavesThisWeekCardProps) {
  return (
    <Card>
      <div className="mb-4 text-[16px] font-medium text-snow">Leaves this week</div>
      {error || !leaves ? (
        <div className="text-body-sm text-smoke">{error ?? "Leave data unavailable."}</div>
      ) : leaves.length === 0 ? (
        <EmptyState tone="subtle" title="No approved leave this week" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {leaves.map((leave) => (
            <li key={leave.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
              <span className="text-snow">{nameById.get(leave.userId) ?? "Unknown"}</span>
              <span className="flex items-center gap-2 text-smoke">
                {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
                <Chip tone="soft" size="sm">
                  {REASON_LABEL[leave.reason]}
                </Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
