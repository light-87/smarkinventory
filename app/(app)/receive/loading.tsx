import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Mirrors receive/page.tsx via ReceiveScreen: header/card tabs + a working form card. */
export default function ReceiveLoading() {
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <Skeleton className="h-6 w-24 rounded" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <SkeletonCard header={false} />
      <SkeletonCard header={false} />
    </div>
  );
}
