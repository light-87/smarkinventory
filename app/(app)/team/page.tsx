import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getActiveEmployeeOptions } from "@/lib/employees/queries";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Employees" };

/**
 * (0018) `/team` — owner-only per-employee overview. Lists active employees;
 * each links to their dashboard (attendance + comp-off + leaves + tasks).
 * Hidden from employee/accountant (area "team" is owner-only in roles.ts) and
 * 404s if they hit the URL directly.
 */
export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user || !isOwner(user.role)) notFound();

  const supabase = await createClient();
  const employees = await getActiveEmployeeOptions(supabase);

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div>
        <h1 className="text-heading-sm font-normal text-snow">Employees</h1>
        <p className="text-[14px] text-smoke">Click a person to see their attendance, comp-off, leaves and tasks.</p>
      </div>

      {employees.length === 0 ? (
        <EmptyState title="No employees yet" description="Add employees under Settings → Users." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((e) => (
            <Link
              key={e.id}
              href={`/team/${e.id}`}
              className="flex flex-col gap-1 rounded-2xl border border-charcoal border-l-4 border-l-nav-team bg-surface px-5 py-4 transition-colors hover:bg-surface-hover"
            >
              <span className="text-[16px] font-medium text-snow">{e.display_name ?? e.username}</span>
              <span className="text-caption text-smoke">@{e.username}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
