import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { shiftMonth, weekdayOf } from "@/lib/attendance/status";
import type { CalendarDay } from "@/lib/attendance/status";
import { statusCellClasses, statusLabel } from "./status-badge";
import { cn } from "@/lib/cn";

export interface CalendarViewProps {
  month: string; // YYYY-MM
  calendar: readonly CalendarDay[];
  selectedDay: string;
  todayDate: string;
  /** Extra query params carried on every nav link (e.g. `user` when owner/accountant is viewing someone else's calendar). */
  extraParams?: Record<string, string>;
  title?: string;
  /** Route the month/day nav links point at (default `/attendance`; the Team dashboard passes `/team/<id>`). */
  basePath?: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hrefFor(basePath: string, month: string, day: string | undefined, extraParams: Record<string, string>): string {
  const params = new URLSearchParams({ month, ...extraParams });
  if (day) params.set("day", day);
  return `${basePath}?${params.toString()}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Month calendar grid — color-coded by derived status (lib/attendance/status).
 * Plain `<Link>`s for month nav + day click (no client JS, mirrors
 * components/daily/day-header.tsx's convention): clicking a date re-navigates
 * `/attendance` with `?day=` set, which the server page re-reads to render
 * the day-breakdown panel below.
 */
export function CalendarView({ month, calendar, selectedDay, todayDate, extraParams = {}, title = "Calendar", basePath = "/attendance" }: CalendarViewProps) {
  const firstDay = calendar[0]?.date;
  const leadingBlanks = firstDay ? weekdayOf(firstDay) : 0;

  return (
    <Card padding="none">
      <CardHeader
        title={title}
        meta={
          <div className="flex items-center gap-2">
            <Link
              href={hrefFor(basePath, shiftMonth(month, -1), undefined, extraParams)}
              className="flex size-8 items-center justify-center rounded-full border border-charcoal text-silver-mist transition-colors hover:bg-ash hover:text-snow"
              aria-label="Previous month"
            >
              ‹
            </Link>
            <span className="min-w-[120px] text-center text-[14px] text-snow">{monthLabel(month)}</span>
            <Link
              href={hrefFor(basePath, shiftMonth(month, 1), undefined, extraParams)}
              className="flex size-8 items-center justify-center rounded-full border border-charcoal text-silver-mist transition-colors hover:bg-ash hover:text-snow"
              aria-label="Next month"
            >
              ›
            </Link>
          </div>
        }
      />
      <div className="px-5 py-[18px]">
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="pb-1 text-[12px] tracking-[0.04em] text-smoke uppercase">
              {w}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {calendar.map((day) => {
            const dayNumber = Number(day.date.slice(-2));
            const isSelected = day.date === selectedDay;
            const isToday = day.date === todayDate;
            return (
              <Link
                key={day.date}
                href={hrefFor(basePath, month, day.date, extraParams)}
                title={statusLabel(day.status, day.holidayName, day.leaveReason)}
                className={cn(
                  "flex aspect-square min-h-9 flex-col items-center justify-center rounded-lg border text-[14px] transition-[filter] hover:brightness-95",
                  statusCellClasses(day.status),
                  isSelected && "ring-2 ring-smark-orange ring-offset-2 ring-offset-surface",
                  isToday && !isSelected && "border-2",
                )}
              >
                {dayNumber}
              </Link>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-faint pt-3 text-caption text-smoke">
          <LegendDot className="border-forest-depth bg-forest-depth/15" label="Present / Comp" />
          <LegendDot className="border-smark-orange bg-surface-accent" label="Leave" />
          <LegendDot className="border-smark-orange-soft bg-smark-orange-soft/10" label="Absent" />
          <LegendDot className="border-charcoal bg-ash" label="Holiday" />
          <LegendDot className="border-charcoal bg-surface-well" label="Not marked" />
        </div>
      </div>
    </Card>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-3 rounded-[4px] border", className)} aria-hidden />
      {label}
    </span>
  );
}
