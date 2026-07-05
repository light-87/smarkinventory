import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors shelves/page.tsx: a header row + stacked shelf bands, each a row of box tiles. */
export default function ShelvesLoading() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <Skeleton className="h-6 w-28 rounded" />
        <Skeleton className="h-3.5 w-64 rounded" />
      </div>
      <div className="flex flex-col gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-charcoal bg-surface p-4">
            <Skeleton className="mb-3 h-4 w-24 rounded" />
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-20 w-28 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
