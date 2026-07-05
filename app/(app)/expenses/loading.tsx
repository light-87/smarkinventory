import { Skeleton, SkeletonRow, SkeletonStatCard } from "@/components/ui/skeleton";

/** Mirrors expenses/page.tsx via ExpensesClient: header + summary tiles + entries table. */
export default function ExpensesLoading() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-6 w-28 rounded" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-[38px] w-24 rounded-full" />
          <Skeleton className="h-[38px] w-28 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface">
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
