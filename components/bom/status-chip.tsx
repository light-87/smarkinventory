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

/**
 * Marks a line whose part was inferred from value + package rather than
 * asserted by a part number (migration 0021, `match_method = 'value_pkg'`).
 *
 * Most of the catalog is generic passives with no MPN and no LCSC number, so
 * this is the only rung that ever reaches them. The match is exact — same value
 * after unit conversion, same package, exactly one candidate — but it is still
 * a different kind of claim from "this line names this part number", and
 * manual-test finding F-002 was hard to spot precisely because inferred links
 * looked identical to asserted ones. This is what makes them visible.
 */
/**
 * Marks a line a person chose between tied stock rows, rather than one the
 * matcher inferred. Distinguished so an operator can see at a glance which
 * links carry a human decision behind them — those are the ones that survive
 * every later re-reconcile.
 */
export function ChosenMatchBadge() {
  return (
    <Chip tone="success" title="You picked this stock item for this line. It stays chosen through re-reconciles.">
      chosen
    </Chip>
  );
}

export function ValuePackageMatchBadge() {
  return (
    <Chip tone="default" title="Matched on value + package, not a part number. Check it if the line looks wrong.">
      value + package
    </Chip>
  );
}
