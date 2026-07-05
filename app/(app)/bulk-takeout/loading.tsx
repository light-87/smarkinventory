import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Mirrors bulk-takeout/page.tsx via BulkTakeoutScreen: title + a working-form card. */
export default function BulkTakeoutLoading() {
  return (
    <div className="mx-auto max-w-[960px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <Skeleton className="mb-5 h-6 w-40 rounded" />
      <SkeletonCard header={false} />
    </div>
  );
}
