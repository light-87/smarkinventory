import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";

export interface UpcomingHoliday {
  date: string;
  name: string;
}

export interface UpcomingHolidaysCardProps {
  holidays: UpcomingHoliday[] | null;
  error?: string | null;
}

/**
 * Company holidays coming up, for EVERY role.
 *
 * Replaces the old "This week's holidays" card, which had two problems the
 * client reported as "holidays don't update": it was rendered (and its query
 * even run) only for owners, so employees never saw it at all; and it only
 * covered the current Mon-Sun week, so a holiday the admin added for next
 * month was invisible to everyone — including the admin who had just added
 * it — until that week finally came around.
 *
 * Weekly offs (`kind = "weekly_off"`, e.g. every Sunday) are deliberately not
 * listed: they're a standing pattern everyone already knows, and expanding
 * them across the window would bury the actual announcements under a run of
 * Sundays. The attendance calendar still shows them per-day.
 */
export function UpcomingHolidaysCard({ holidays, error }: UpcomingHolidaysCardProps) {
  return (
    <Card>
      <div className="mb-4 text-[17px] font-medium text-snow">Upcoming holidays</div>
      {error || !holidays ? (
        <div className="text-body-sm text-smoke">{error ?? "Holiday data unavailable."}</div>
      ) : holidays.length === 0 ? (
        <EmptyState tone="subtle" title="No holidays coming up" description="Company holidays the owner adds will show up here." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-2 text-[15px]">
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
