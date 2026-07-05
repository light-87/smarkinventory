"use client";

import { useRouter } from "next/navigation";
import { Drawer, DrawerCloseButton, DrawerHeader } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { PartDetailView } from "@/components/part-detail/part-detail-view";
import { useInventoryFilters } from "@/hooks/use-inventory-filters";
import type { InventoryListResult } from "@/lib/inventory/query";
import type { PartDetailResult } from "@/lib/part-events/types";
import { FacetSidebar } from "./facet-sidebar";
import { InventoryTable } from "./inventory-table";
import { InventoryToolbar } from "./toolbar";

export interface InventoryClientProps {
  listResult: InventoryListResult;
  /** `?pid=` from the URL — non-null opens the drawer (tab-inventory.md §2, tab-part-detail.md). */
  drawerPid: string | null;
  drawerResult: PartDetailResult | null;
}

export function InventoryClient({ listResult, drawerPid, drawerResult }: InventoryClientProps) {
  const router = useRouter();
  const parts = listResult.ok ? listResult.parts : [];
  const filters = useInventoryFilters(parts);

  const closeDrawer = () => router.push("/inventory");

  if (!listResult.ok) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          tone="subtle"
          title="Couldn't load inventory"
          description={listResult.error}
        />
      </div>
    );
  }

  // Right after a row click, the URL's `pid` updates before the server
  // round-trip lands new `drawerResult` props — treat a stale/missing result
  // as "loading" rather than flashing an empty/error state.
  const drawerIsLoading =
    !!drawerPid && (!drawerResult || (drawerResult.ok && drawerResult.data.part.internal_pid !== drawerPid));

  return (
    <div className="flex h-full min-h-0">
      <FacetSidebar
        groups={filters.facetGroups}
        isGroupOpen={filters.isGroupOpen}
        onToggleGroupOpen={filters.toggleGroupOpen}
        onToggleValue={filters.toggleValue}
        onClearAll={filters.clearAll}
        hasFilters={filters.hasFilters}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <InventoryToolbar
          search={filters.search}
          onSearchChange={filters.setSearch}
          activeChips={filters.activeChips}
          onRemoveChip={filters.toggleValue}
          resultCount={filters.filteredParts.length}
          totalCount={parts.length}
          exportHref={filters.exportHref}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {filters.filteredParts.length === 0 ? (
            <div className="p-8">
              <EmptyState
                tone="subtle"
                title="No parts match your filters"
                description="Try clearing a filter or the search term."
              />
            </div>
          ) : (
            <InventoryTable parts={filters.filteredParts} />
          )}
        </div>
      </div>

      {drawerPid && (
        <Drawer open onClose={closeDrawer} aria-label="Part detail">
          {drawerIsLoading ? (
            <DrawerLoading pid={drawerPid} onClose={closeDrawer} />
          ) : drawerResult && !drawerResult.ok ? (
            <DrawerError result={drawerResult} onClose={closeDrawer} />
          ) : drawerResult && drawerResult.ok ? (
            <PartDetailView data={drawerResult.data} variant="drawer" onClose={closeDrawer} />
          ) : null}
        </Drawer>
      )}
    </div>
  );
}

function DrawerLoading({ pid, onClose }: { pid: string; onClose: () => void }) {
  return (
    <>
      <DrawerHeader>
        <div className="font-mono text-2xl text-snow">{pid}</div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>
      <div className="flex flex-col gap-3 px-6 py-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-raised" />
        ))}
      </div>
    </>
  );
}

function DrawerError({
  result,
  onClose,
}: {
  result: Extract<PartDetailResult, { ok: false }>;
  onClose: () => void;
}) {
  return (
    <>
      <DrawerHeader>
        <div className="text-[15px] text-snow">Part detail</div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>
      <div className="px-6 py-8">
        <EmptyState
          tone="subtle"
          title={result.reason === "not_found" ? "No part with that code" : "Couldn't load this part"}
          description={result.message ?? "Please try again."}
        />
      </div>
    </>
  );
}
