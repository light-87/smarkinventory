import { InventoryClient } from "@/components/inventory/inventory-client";
import { getInventoryList } from "@/lib/inventory/query";
import { getPartDetailData } from "@/lib/part-events/query";
import { getSessionUser } from "@/lib/auth/session";
import { effectiveCanSee } from "@/lib/rbac/access";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Inventory" };

interface InventoryPageProps {
  searchParams: Promise<{ pid?: string }>;
}

/**
 * `/inventory` (tab-inventory.md) — facet sidebar + search + table, with the
 * part-detail drawer at `?pid=SMK-000101` (tab-part-detail.md). Note for
 * integrator: this assumes a ~60px sticky shell header (matches the approved
 * prototype's own `calc(100vh - 60px)`) — once `app/(app)/layout.tsx` (auth-shell)
 * lands, confirm that offset still matches its real header height.
 */
export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const { pid } = await searchParams;

  const sessionUser = await getSessionUser();
  if (!sessionUser || !effectiveCanSee(sessionUser.role, "inventory", sessionUser.grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Your account doesn't have access to Inventory. Ask an owner to grant the Inventory module." />
      </div>
    );
  }

  const listResult = await getInventoryList();
  const drawerResult = pid ? await getPartDetailData(pid) : null;

  return <InventoryClient listResult={listResult} drawerPid={pid ?? null} drawerResult={drawerResult} />;
}
