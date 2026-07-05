import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/** Mirrors inventory/page.tsx via InventoryClient: facet sidebar + toolbar + table rows. */
export default function InventoryLoading() {
  return (
    <div className="flex h-[calc(100dvh-120px)] min-h-0 md:h-[calc(100dvh-60px)]">
      <aside className="hidden w-[250px] flex-none space-y-4 overflow-y-auto border-r border-charcoal px-3.5 py-4 lg:block">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-4/5 rounded" />
          </div>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2.5 border-b border-charcoal px-4 py-3">
          <Skeleton className="h-9 flex-1 rounded-full" />
          <Skeleton className="h-9 w-24 flex-none rounded-full" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonRow key={i} withIcon />
          ))}
        </div>
      </div>
    </div>
  );
}
