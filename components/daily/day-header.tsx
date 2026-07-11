import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { shiftDateOnly, todayDateOnly } from "@/lib/daily/compute";
import type { AppUserOption } from "@/lib/daily/queries";

export interface DayHeaderProps {
  viewedDate: string;
  personParam: string;
  showPersonFilter: boolean;
  people: readonly AppUserOption[];
}

function hrefFor(date: string, person: string): string {
  const params = new URLSearchParams({ date });
  if (person !== "all") params.set("person", person);
  return `/daily?${params.toString()}`;
}

/**
 * Day header — date nav + person filter (FEATURES.md §5.13: "date picker
 * default today, prev/next arrows; person filter"). Deliberately a plain
 * `<form method="get">` + `<Link>`s, no client JS: every control just
 * re-navigates `/daily` with new query params, which the server page
 * (app/(app)/daily/page.tsx) re-reads on each render.
 */
export function DayHeader({ viewedDate, personParam, showPersonFilter, people }: DayHeaderProps) {
  const isToday = viewedDate === todayDateOnly();

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            href={hrefFor(shiftDateOnly(viewedDate, -1), personParam)}
            className="flex size-9 items-center justify-center rounded-full border border-charcoal text-silver-mist transition-colors hover:bg-ash hover:text-snow"
            aria-label="Previous day"
          >
            ‹
          </Link>
          <div className="text-[16px] text-snow">
            {formatDate(viewedDate)}
            {isToday && <span className="ml-2 text-caption text-smark-orange">Today</span>}
          </div>
          <Link
            href={hrefFor(shiftDateOnly(viewedDate, 1), personParam)}
            className="flex size-9 items-center justify-center rounded-full border border-charcoal text-silver-mist transition-colors hover:bg-ash hover:text-snow"
            aria-label="Next day"
          >
            ›
          </Link>
          {!isToday && (
            <Link href={hrefFor(todayDateOnly(), personParam)} className="text-caption text-smark-orange hover:text-smark-orange-hover">
              Jump to today
            </Link>
          )}
        </div>

        <form method="get" action="/daily" className="flex flex-wrap items-center gap-2">
          <input type="date" name="date" defaultValue={viewedDate} className="h-9 rounded-lg border border-charcoal bg-surface-well px-3 text-[14px] text-snow outline-none focus:border-smark-orange" />
          {showPersonFilter && (
            <select
              name="person"
              defaultValue={personParam}
              className="h-9 rounded-lg border border-charcoal bg-surface-well px-3 text-[14px] text-snow outline-none focus:border-smark-orange"
              aria-label="Person"
            >
              <option value="all">All people</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName ?? p.username}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" size="sm" variant="outline">
            View
          </Button>
        </form>
      </div>
    </Card>
  );
}
