import { Card } from "@/components/ui/card";
import type { DashboardFilterOptions, DashboardFilters } from "@/lib/pm/dashboard";

export interface FilterBarProps {
  filters: DashboardFilters;
  options: DashboardFilterOptions;
}

/**
 * Combinable filter bar: date range + client + project + employee, all via a
 * single GET form (no client JS, no date-picker/select library — mirrors the
 * `<form method="get">` + native `<select>` pattern already used by
 * app/(app)/attendance/page.tsx's "Viewing calendar for" control). There is no
 * reusable date-RANGE component anywhere in the repo (components/attendance/
 * calendar-view.tsx is a month-grid single-day picker, not a from/to range),
 * so the range itself is two native `<input type="date">` fields — zero
 * dependency, works at 360px, native mobile date UI.
 */
export function FilterBar({ filters, options }: FilterBarProps) {
  const selectClass =
    "h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-[14px] text-snow outline-none focus:border-smark-orange sm:w-auto";
  const dateClass =
    "h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-[14px] text-snow outline-none focus:border-smark-orange sm:w-auto";

  return (
    <Card>
      <form method="get" action="/project-dashboard" className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-[13px] text-smoke">
            From
            <input type="date" name="from" defaultValue={filters.from ?? ""} className={dateClass} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-smoke">
            To
            <input type="date" name="to" defaultValue={filters.to ?? ""} className={dateClass} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-smoke">
            Client
            <select name="client" defaultValue={filters.client ?? ""} className={selectClass}>
              <option value="">All clients</option>
              {options.clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-smoke">
            Project
            <select name="project" defaultValue={filters.projectId ?? ""} className={selectClass}>
              <option value="">All projects</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-smoke">
            Employee
            <select name="employee" defaultValue={filters.employeeId ?? ""} className={selectClass}>
              <option value="">All employees</option>
              {options.engineers.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.displayName ?? e.username}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="flex h-10 items-center justify-center rounded-lg bg-lime px-5 text-[14px] font-medium text-obsidian transition-colors hover:bg-lime-hover"
          >
            Apply filters
          </button>
          <a href="/project-dashboard" className="text-[14px] text-smoke transition-colors hover:text-snow">
            Clear
          </a>
        </div>
      </form>
    </Card>
  );
}
