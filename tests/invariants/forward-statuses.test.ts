import { describe, test } from "bun:test";

/**
 * INVARIANT — forward-only statuses (plan/TESTING.md §5.5 · CROSS-FEATURE.md
 * A3.6). "Status walks only forward (cart→ordered→arrived); ... BOM name
 * unique per project." (PO uniqueness is split out into po-unique.test.ts —
 * same source bullet, dedicated file per the R2-29 skeleton list.)
 * Canonical shape: SCHEMA.md `smark_cart_items.status`
 * (open/dismissed/ordered), `smark_orders.status`
 * (ordered/partially_arrived/arrived), `smark_order_lines.line_status`
 * (ordered/arrived), `smark_boms` UNIQUE(project_id, name) [R2-03].
 * Applies at: unit (status-walk transition function), DB (constraints/
 * triggers rejecting backward writes), API (checkout, mark-arrived,
 * BOM-create/rename routes), E2E-3.
 * Skeleton (test.todo) until the cart/orders package lands. Convert todos
 * to real tests in place — keep the names.
 */

describe("invariant: forward-only statuses", () => {
  test.todo(
    "smark_cart_items.status transitions open→ordered only — no API path sets an `ordered` line back to `open`",
    () => {},
  );
  test.todo(
    "smark_order_lines.line_status transitions ordered→arrived only — never arrived→ordered",
    () => {},
  );
  test.todo(
    "smark_orders.status walks ordered→partially_arrived→arrived only — never backwards, and never skips to arrived while any line is still `ordered`",
    () => {},
  );
  test.todo(
    "the ONE documented exception: a dismissed auto-shortfall cart line resurrects to `open` only when shortfall grows beyond the dismissed qty [Q-05] — this is the sole open↔dismissed back-edge; ordered lines never re-open",
    () => {},
  );
  test.todo(
    "each distributor-order group from a split checkout [Q-06] walks its own status independently — one distributor's late/partial arrival never rewinds or blocks another distributor's order status",
    () => {},
  );
  test.todo(
    "BOM name is UNIQUE per project (UNIQUE(project_id, name), R2-03) — the create/rename API returns a friendly conflict error, not a raw constraint violation, and no path (upload OR in-app create) bypasses the check",
    () => {},
  );
  test.todo(
    "put-away (arrival confirm) is the only path that flips a line to `arrived` — no direct status-field edit exists anywhere in the UI/API surface",
    () => {},
  );
});
