import { Chip } from "@/components/ui/chip";
import { formatNumber } from "@/lib/format";
import type { BomLineMatchState } from "@/types/db";

export interface LineStatusChipProps {
  matchState: BomLineMatchState;
  /** Set only for in-stock lines whose part is cross-project contested [R2-10]. */
  contestedShortfall?: number | null;
  /** "Shelf B · Box B-12" — populated only when a stock location exists. */
  locationLabel?: string | null;
}

/**
 * The reconcile-table status tag (plan/tab-orders-projects.md §2/§5): plain
 * in-stock shows its location, an orange "To order" covers both a matched
 * line short on stock and a fully unresolved one, and a contested in-stock
 * part gets the "shortfall in cart ×N" chip instead of its location [R2-10].
 */
export function LineStatusChip({ matchState, contestedShortfall, locationLabel }: LineStatusChipProps) {
  if (matchState === "in_stock") {
    if (contestedShortfall && contestedShortfall > 0) {
      return (
        <Chip tone="warn" mono>
          shortfall in cart ×{formatNumber(contestedShortfall)}
        </Chip>
      );
    }
    return <Chip tone="success">{locationLabel ?? "In stock"}</Chip>;
  }
  return <Chip tone="accent">To order</Chip>;
}

/** Small muted marker alongside the status chip for do-not-populate lines. */
export function DnpBadge() {
  return <Chip tone="default">DNP</Chip>;
}
