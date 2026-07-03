import Link from "next/link";
import { PartDetailView } from "@/components/part-detail/part-detail-view";
import { EmptyState } from "@/components/ui/empty-state";
import { getPartDetailData } from "@/lib/part-events/query";

interface PartDetailPageProps {
  params: Promise<{ pid: string }>;
}

export async function generateMetadata({ params }: PartDetailPageProps) {
  const { pid } = await params;
  return { title: pid };
}

/**
 * `/part/[pid]` (tab-part-detail.md) — standalone deep-linkable page. Stands
 * in for the intercepting-route drawer ("#/part/:pid ... deep-linkable;
 * closing restores the underlying route") until `app/(app)/layout.tsx`
 * (auth-shell) exists to host a `@modal` parallel slot — note for integrator:
 * once that lands, wire an intercepting `(.)part/[pid]` segment so navigating
 * here from Shelves/Scan/Search opens over the current screen instead of
 * away from it; this page keeps working as the direct-link fallback either way.
 */
export default async function PartDetailPage({ params }: PartDetailPageProps) {
  const { pid } = await params;
  const result = await getPartDetailData(pid);

  if (!result.ok) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-60px)] max-w-lg items-center justify-center px-6 py-16">
        <EmptyState
          title={result.reason === "not_found" ? `No part found for "${pid}"` : "Couldn't load this part"}
          description={result.message ?? "Please try again."}
          actions={
            <Link href="/inventory" className="text-[13px] text-smark-orange-soft hover:underline">
              ← Back to Inventory
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-[calc(100vh-60px)] max-w-2xl border-x border-charcoal bg-surface">
      <PartDetailView data={result.data} variant="page" />
    </div>
  );
}
