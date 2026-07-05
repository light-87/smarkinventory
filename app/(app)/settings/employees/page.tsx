import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getEmployeeDirectory } from "@/lib/employees/queries";
import { EmployeesDirectory } from "@/components/employees/employees-directory";

export const metadata: Metadata = { title: "Employees" };

/**
 * `/settings/employees` — owner: full profile + documents for every active
 * employee; accountant: same view, read-only (payroll need — bank/PAN visible,
 * per migration 0011's RLS: accountant SELECT on both smark_employee_private
 * and smark_employee_documents). Any other role (or an employee poking the URL
 * directly) 404s — this is NOT reachable from the `employee`-visible nav at
 * all (lib/nav.ts has no entry pointing here).
 */
export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user || (user.role !== "owner" && user.role !== "accountant")) notFound();

  const supabase = await createClient();
  const entries = await getEmployeeDirectory(supabase);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <h1 className="text-[24px] font-normal text-snow">Employees</h1>
      <EmployeesDirectory entries={entries} canSeeBank />
    </div>
  );
}
