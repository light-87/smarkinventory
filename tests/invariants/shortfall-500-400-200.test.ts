import { describe, test } from "bun:test";

/**
 * INVARIANT — the client's permanent shortfall example (FEATURES.md §16:
 * "Client's own example is a permanent test: 500 avail / 400 + 200
 * demanded → auto cart line of exactly 100." · plan/TESTING.md §1 principle
 * 5 + §3 E2E-3 · CROSS-FEATURE.md R2-09/10/12). This file pins that exact
 * scenario plus the Q-05 lifecycle rules around it (recompute triggers,
 * dismissal-resurrect, archive release) so the canonical numbers can never
 * silently drift as the demand engine evolves.
 * Canonical shape: SCHEMA.md `v_part_demand` [R2-10 · Q-05 FINAL] — demand =
 * Σ(line qty × bom.build_qty) over matched lines in active, reconciled BOMs
 * of non-archived projects (per-project breakdown); available = total_qty;
 * shortfall = GREATEST(demand − available, 0). Shortfall > 0 with no open
 * auto line → insert `smark_cart_items` (source=auto_shortfall). Recompute
 * on: reconcile, BOM upload/archive, movements, build_qty change.
 * Applies at: unit (view/demand math — the primary home for this test),
 * API (reconcile route), E2E-3 ("shortfall example: 500/400/200 → exactly
 * 100 auto-line").
 * Skeleton (test.todo) until the cart/demand package lands. Convert todos
 * to real tests in place — keep the exact numbers and the names.
 */

describe("invariant: 500/400/200 → 100 shortfall (client's permanent example)", () => {
  test.todo(
    "canonical case: part with total_qty=500; Project A's active reconciled BOM needs 400 of it, Project B's active reconciled BOM needs 200 of it → v_part_demand.shortfall === 100 (exactly GREATEST(400+200-500, 0))",
    () => {},
  );
  test.todo(
    "the canonical case auto-creates EXACTLY ONE smark_cart_items row: source='auto_shortfall', qty_to_order=100 — not two lines, not a line per project",
    () => {},
  );
  test.todo(
    "the auto line's demand jsonb breaks down per-project as [{project: A, qty: 400}, {project: B, qty: 200}] — the full per-project demand, not just the 100 shortfall",
    () => {},
  );
  test.todo(
    "build_qty change: doubling Project A's build_qty (need becomes 800+200=1000 against 500 available) recomputes shortfall to exactly 500 on the SAME cart line, not a second one [R2-27]",
    () => {},
  );
  test.todo(
    "arrival: stock arriving to bring total_qty to 600 (500+100) recomputes shortfall to exactly 0 and releases/closes the auto line — it is not left open at qty 100",
    () => {},
  );
  test.todo(
    "partial release: bulk-picking against Project A's BOM line releases only Project A's portion of demand — shortfall recomputes to reflect Project B's 200 alone, not an all-or-nothing reset",
    () => {},
  );
  test.todo(
    "dismissal-resurrect: an auto line dismissed at shortfall=100 resurrects when demand grows to shortfall=150 (grows beyond the dismissed qty) [Q-05]",
    () => {},
  );
  test.todo(
    "dismissal stays dismissed: an auto line dismissed at shortfall=100 does NOT resurrect if demand later recomputes to shortfall=100 or less (no growth beyond the dismissed qty)",
    () => {},
  );
  test.todo(
    "archive release: archiving Project B (its 200 demand) recomputes shortfall to GREATEST(400-500, 0) = 0 and closes the auto line, even though Project A's BOM is untouched [R2-32]",
    () => {},
  );
});
