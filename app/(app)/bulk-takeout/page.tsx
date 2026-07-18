import type { Metadata } from "next";
import { BulkTakeoutScreen } from "@/components/takeout/bulk-takeout-screen";
import { EmptyState } from "@/components/ui/empty-state";
import { effectiveCanSee, effectiveCanWrite } from "@/lib/rbac/access";
import { getInventoryAccessIfEmployee, getModuleGrantsIfEmployee } from "@/lib/rbac/queries";
import { createClient } from "@/lib/supabase/server";
import { getPickableProjects } from "@/lib/takeout/queries";

export const metadata: Metadata = { title: "Bulk takeout" };

/**
 * `/bulk-takeout` (plan/tab-bulk-pick.md · FEATURES.md §5.6 — display name
 * "Bulk takeout" everywhere per R2-26; the route/movement-reason key
 * `bulk_pick` is unchanged). Owner/employee full, accountant read-only
 * (FEATURES.md §2).
 */
export default async function BulkTakeoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: role } = user ? await supabase.rpc("smark_role") : { data: null };
  const grantedModules = role && user ? await getModuleGrantsIfEmployee(supabase, user.id, role) : [];

  if (!role || !effectiveCanSee(role, "bulk_takeout", grantedModules)) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Sign in with an owner, employee, or accountant account to view Bulk takeout." />
      </div>
    );
  }

  const pickableProjects = await getPickableProjects(supabase);
  const inventoryAccess = user ? await getInventoryAccessIfEmployee(supabase, user.id, role) : null;

  return (
    <div className="mx-auto max-w-[960px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <h1 className="mb-5 text-heading-sm font-normal text-snow">Bulk takeout</h1>
      <BulkTakeoutScreen
        pickableProjects={pickableProjects}
        canWrite={effectiveCanWrite(role, "bulk_takeout", { inventoryAccess })}
      />
    </div>
  );
}
