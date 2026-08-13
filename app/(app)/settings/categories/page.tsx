import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { effectiveCanSee } from "@/lib/rbac/access";
import { EmptyState } from "@/components/ui/empty-state";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { getCategoryUsage } from "@/lib/categories/queries";

export const metadata: Metadata = { title: "Categories" };

/** Settings → Categories: rename categories and sub-categories across the catalog. */
export default async function CategoriesSettingsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || !effectiveCanSee(sessionUser.role, "inventory", sessionUser.grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Ask an owner to grant the Inventory module." />
      </div>
    );
  }

  const supabase = await createClient();
  const [categories, { data: canEdit }] = await Promise.all([
    getCategoryUsage(supabase),
    supabase.rpc("smark_can_edit_inventory"),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pt-6 pb-24 sm:px-6">
      <h1 className="text-[24px] font-normal text-snow">Categories</h1>
      <CategoriesManager categories={categories} writable={Boolean(canEdit)} />
    </div>
  );
}
