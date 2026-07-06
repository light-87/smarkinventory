import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";

export interface WeeklyHoliday {
  date: string;
  name: string;
}

export interface WeeklyHolidaysCardProps {
  holidays: WeeklyHoliday[] | null;
  error?: string | null;
}

/** Owner-only: every day of the current Mon-Sun week that resolves to a holiday (lib/attendance/status.ts findHolidayForDate, existing pure helper — no new query needed, smark_holidays is already company-wide readable via the existing getHolidays). */
export function WeeklyHolidaysCard({ holidays, error }: WeeklyHolidaysCardProps) {
  return (
    <Card>
      <div className="mb-4 text-[15px] font-medium text-snow">This week&apos;s holidays</div>
      {error || !holidays ? (
        <div className="text-body-sm text-smoke">{error ?? "Holiday data unavailable."}</div>
      ) : holidays.length === 0 ? (
        <EmptyState tone="subtle" title="No holidays this week" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-snow">{h.name}</span>
              <Chip tone="default" size="sm" mono>
                {formatDate(h.date)}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
