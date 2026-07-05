import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/** Mirrors shelves/[boxId]/page.tsx: breadcrumb + box detail card + contents table. */
export default function BoxDetailLoading() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <Skeleton className="mb-[18px] h-3.5 w-40 rounded" />
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-[280px] flex-none rounded-2xl border border-charcoal bg-surface p-5">
          <Skeleton className="mx-auto mb-4 size-32 rounded-lg" />
          <Skeleton className="mb-2 h-4 w-24 rounded" />
          <Skeleton className="h-3 w-32 rounded" />
        </div>
        <div className="min-w-[300px] flex-1 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
