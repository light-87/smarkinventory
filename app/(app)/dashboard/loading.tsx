import { Skeleton, SkeletonCard, SkeletonRow, SkeletonStatCard } from "@/components/ui/skeleton";

/** Mirrors dashboard/page.tsx: stat grid, then movements + agent activity/usage. */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-[26px] sm:grid-cols-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface">
          <div className="flex items-center justify-between border-b border-border-divider px-5 py-4">
            <Skeleton className="h-3.5 w-36 rounded" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
          <div className="divide-y divide-border-hairline">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
