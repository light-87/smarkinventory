import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Mirrors attendance/page.tsx: calendar + day-breakdown panel, then leave/approvals cards. */
export default function AttendanceLoading() {
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <Skeleton className="h-7 w-40 rounded" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-charcoal bg-surface p-4">
          <Skeleton className="mb-4 h-4 w-32 rounded" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        </div>
        <SkeletonCard />
      </div>
      <SkeletonCard />
    </div>
  );
}
