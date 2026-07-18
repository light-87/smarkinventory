import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { BirthdayView } from "@/lib/attendance/queries";

/** "5 Jul" style — month+day only, year is deliberately never shown (birthdays are matched ignoring year). */
function formatMonthDay(birthDate: string): string {
  const [, month, day] = birthDate.split("-").map(Number);
  const d = new Date(Date.UTC(2001, (month ?? 1) - 1, day ?? 1));
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export interface BirthdaysThisWeekCardProps {
  birthdays: BirthdayView[] | null;
  error?: string | null;
}

/** Owner-only: active users whose birth_date (month+day, year ignored) falls in the current Mon-Sun week (lib/attendance/queries.ts getUpcomingBirthdays). */
export function BirthdaysThisWeekCard({ birthdays, error }: BirthdaysThisWeekCardProps) {
  return (
    <Card>
      <div className="mb-4 text-[17px] font-medium text-snow">Birthdays this week</div>
      {error || !birthdays ? (
        <div className="text-body-sm text-smoke">{error ?? "Birthday data unavailable."}</div>
      ) : birthdays.length === 0 ? (
        <EmptyState tone="subtle" title="No birthdays this week" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {birthdays.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 text-[15px]">
              <span className="text-snow">{b.displayName ?? b.username}</span>
              <span className="font-mono text-smoke">{formatMonthDay(b.birthDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
