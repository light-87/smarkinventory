import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getActiveEmployeeOptions } from "@/lib/employees/queries";
import { getAllModuleGrants } from "@/lib/rbac/queries";
import { ModuleGrantsGrid } from "@/components/rbac/module-grants-grid";
import { AddEmployeeForm } from "@/components/rbac/add-employee-form";

export const metadata: Metadata = { title: "Users & roles" };

/**
 * `/settings/users` (migration 0013) — owner-only per-employee module-grant
 * grid (Inventory / Project management / Attendance toggles). This is the
 * page Settings' "Users & roles" link has pointed at since before this
 * package existed, without ever being built — Settings → Employees
 * (lib/employees/**, a separate profile/document directory) stays as-is;
 * the two links now both resolve to real, distinct pages.
 */
export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "owner") notFound();

  const supabase = await createClient();
  const [employees, grants] = await Promise.all([getActiveEmployeeOptions(supabase), getAllModuleGrants(supabase)]);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div>
        <h1 className="text-[24px] font-normal text-snow">Users & roles</h1>
        <p className="mt-1 text-[13px] text-smoke">
          Grant or revoke module access per employee. Owner and accountant accounts are unaffected — they always keep
          full access.
        </p>
      </div>
      <AddEmployeeForm />
      <ModuleGrantsGrid
        employees={employees.map((e) => ({ id: e.id, username: e.username, displayName: e.display_name }))}
        initialGrants={grants}
      />
    </div>
  );
}
