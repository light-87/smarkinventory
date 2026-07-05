import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/** Mirrors daily/page.tsx: header/date picker + team/movements/ordering tables. */
export default function DailyReportsLoading() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-6 w-36 rounded" />
        <Skeleton className="h-9 w-40 rounded-full" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface">
        <div className="border-b border-border-divider px-5 py-4">
          <Skeleton className="h-3.5 w-28 rounded" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface">
        <div className="border-b border-border-divider px-5 py-4">
          <Skeleton className="h-3.5 w-40 rounded" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
