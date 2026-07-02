import { describe, test } from "bun:test";

/**
 * INVARIANT — order-number (PO) uniqueness (plan/TESTING.md §5.5 + §6 Q-06 ·
 * FEATURES.md §16 "order-number uniqueness"). Split out from the
 * forward-statuses bullet into its own file per the R2-29 skeleton list.
 * "Checkout groups by distributor → one order per group with its website
 * order number (required, unique)."
 * Canonical shape: SCHEMA.md `smark_orders.po_number` — "the website's order
 * number (required, UNIQUE — used to match deliveries)"; placing an order
 * auto-creates a draft `smark_expenses` row [Q-09] via `source_order_id`.
 * Applies at: DB (UNIQUE constraint — also covered from the migration angle
 * in tests/integration/db-schema.test.ts), API (checkout route — one
 * required po_number per distributor group).
 * Skeleton (test.todo) until the cart/orders package lands. Convert todos
 * to real tests in place — keep the names.
 */

describe("invariant: PO (order number) uniqueness", () => {
  test.todo(
    "checkout API rejects a distributor group submitted without a po_number (400 'PO required'), never creates a draft order",
    () => {},
  );
  test.todo(
    "smark_orders.po_number is globally UNIQUE — a second order reusing an existing po_number is rejected, even across different distributors or unrelated checkout sessions",
    () => {},
  );
  test.todo(
    "a multi-distributor checkout [Q-06] requires N distinct po_numbers for N distributor groups — one missing/duplicate value blocks only that group's order, not the whole checkout",
    () => {},
  );
  test.todo(
    "editing an existing order's po_number to collide with a different order's po_number is rejected on UPDATE, not just on INSERT",
    () => {},
  );
  test.todo(
    "a rejected duplicate-PO submission never creates the auto-draft smark_expenses row — the PO-unique check runs BEFORE the draft-expense side effect [Q-09], so a failed checkout leaves zero orphaned draft expenses",
    () => {},
  );
  test.todo(
    "successful PO placement stamps source_order_id on its draft expense, and that link is 1:1 (no two draft expenses point at the same order)",
    () => {},
  );
});
