import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/** Mirrors cart/page.tsx via CartScreen: header + grouped cart-line rows. */
export default function CartLoading() {
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <Skeleton className="h-6 w-20 rounded" />
      <div className="overflow-hidden rounded-2xl border border-charcoal bg-surface">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonRow key={i} withIcon />
        ))}
      </div>
    </div>
  );
}
