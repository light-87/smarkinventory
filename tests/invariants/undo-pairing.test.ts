import { describe, test } from "bun:test";

/**
 * INVARIANT — undo pairing (plan/TESTING.md §5.2 · CROSS-FEATURE.md A3.3 ·
 * FEATURES.md §9). "Every stock mutation writes a movement and is undoable
 * once (toast Undo / `undo_of` chain correct)."
 * Canonical shape: SCHEMA.md `smark_movements` (part_id, big_box_id,
 * delta_qty, reason: pick/receive/adjust/bulk_pick/undo, bom_id, actor,
 * undo_of nullable).
 * Applies at: unit (movement service — pure delta/pairing math), API (scan
 * take-out/add, bulk pick finish, receive confirm, adjust routes), worker
 * (bulk pick finish under concurrency), E2E-2.
 * Skeleton (test.todo) until the inventory-core package lands the movement
 * write path. Convert todos to real tests in place — keep the names.
 */

describe("invariant: undo pairing", () => {
  test.todo(
    "every stock-mutating action (scan take-out/add, bulk_pick finish, receive confirm, qty adjust) writes exactly one smark_movements row",
    () => {},
  );
  test.todo(
    "undo creates a NEW movement row with delta_qty negated and undo_of = the original row's id — the original row is never mutated or deleted (append-only)",
    () => {},
  );
  test.todo(
    "undo stamps reason='undo' on the reversing row; the original row keeps its original reason (pick/receive/adjust/bulk_pick)",
    () => {},
  );
  test.todo(
    "a movement can be undone at most once — undoing an already-undone movement (undo_of already points at it) is rejected, not a silent no-op",
    () => {},
  );
  test.todo(
    "undo-of-undo is rejected — a movement whose reason='undo' cannot itself be undone (no undo chains)",
    () => {},
  );
  test.todo(
    "an undo pair nets to zero: total_qty after undo equals total_qty immediately before the original mutation",
    () => {},
  );
  test.todo(
    "guided box-audit variances (adjust movements tagged audit, FEATURES.md §4) are undoable through the same pairing rule as any other movement",
    () => {},
  );
  test.todo(
    "the undo movement stamps the actor who performed the undo (may differ from the original movement's actor — e.g. owner undoing an employee's mistake)",
    () => {},
  );
});
