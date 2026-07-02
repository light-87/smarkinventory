import { describe, test } from "bun:test";

/**
 * INVARIANT — package-mandatory (plan/TESTING.md §5.4 · CROSS-FEATURE.md
 * A3.2). "Package-mandatory can't be disabled via any API path." "Package
 * match is mandatory in the ladder; a change may add rules but not make
 * package optional."
 * Canonical shape: FEATURES.md §7 ladder position 4 ("Package — mandatory,
 * never substitutable"). SCHEMA.md `smark_ordering_rules` (key=package,
 * `mandatory bool` true, non-disableable; Settings "Add rule" inserts
 * `custom` rows only — never replaces the seeded ladder).
 * Applies at: unit (matcher ladder — package short-circuit), DB (CHECK/
 * trigger blocking mandatory=false on the package row), API (Settings rules
 * routes), worker (agent run — package match feeds is_recommended).
 * Skeleton (test.todo) until the ordering-rules package lands. Convert
 * todos to real tests in place — keep the names.
 */

describe("invariant: package-mandatory", () => {
  test.todo(
    "seeded smark_ordering_rules row for key='package' has mandatory=true and enabled=true out of the box",
    () => {},
  );
  test.todo(
    "Settings API: PATCH/UPDATE attempting to set the package rule's enabled=false is rejected (403/400), not silently accepted",
    () => {},
  );
  test.todo(
    "Settings API: PATCH/UPDATE attempting to set the package rule's mandatory=false is rejected — no API path can flip this flag",
    () => {},
  );
  test.todo(
    "DB layer: a direct UPDATE setting mandatory=false or enabled=false on the package rule violates a CHECK constraint/trigger — the invariant holds even bypassing the app layer",
    () => {},
  );
  test.todo(
    "the standard search ladder (matcher) always evaluates package match regardless of run tier (economy/balanced/thorough) or concurrency preset",
    () => {},
  );
  test.todo(
    "an agent result with package_match=false is NEVER marked is_recommended=true, even when MPN/price/stock/status all match",
    () => {},
  );
  test.todo(
    "the reconcile matcher (BOM reconcile, bulk-takeout resolution, duplicate-part guard — one shared matcher per FEATURES.md §7) applies the same package-mandatory short-circuit in all three consumers",
    () => {},
  );
  test.todo(
    "adding a custom ordering rule via Settings appends a new `custom` row — it never reorders or supersedes the package row's mandatory status",
    () => {},
  );
});
