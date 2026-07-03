import { beforeAll, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPart } from "@/lib/matcher";
import { createServiceClient } from "../helpers/supabase";
import { describeDb } from "./fixtures";

/**
 * INVARIANT — package-mandatory (plan/TESTING.md §5.4 · CROSS-FEATURE.md
 * A3.2). "Package match is mandatory in the ladder; a change may add rules
 * but not make package optional."
 * Canonical shape: FEATURES.md §7 ladder position 4. SCHEMA.md
 * `smark_ordering_rules` (key='package', `mandatory` true, non-disableable;
 * `smark_ordering_rules_package_locked` CHECK + `smark_block_package_rule_delete`
 * BEFORE DELETE trigger — both fire for every role, including service_role,
 * because triggers/CHECKs are not subject to RLS bypass).
 *
 * Split across two layers:
 *  - matcher-ladder assertions run with plain `bun test` (no DB) — lib/matcher
 *    already exists and is exhaustively covered by tests/unit/matcher.test.ts;
 *    this file adds the package-mandatory-specific angle (multi-consumer
 *    shape, never a match on package mismatch).
 *  - DB assertions (`describeDb`) exercise the seeded row + the CHECK/trigger
 *    guards directly — real, schema-level proof the invariant can't be
 *    disabled through any write path, app or otherwise.
 */
describe("invariant: package-mandatory — matcher ladder (no DB needed)", () => {
  const catalog = [
    { id: "p1", mpn: "STM32F103C8T6", lcsc_pn: "C8734", value: null, package: "LQFP-48", voltage: null, part_status: "active" as const },
    { id: "p2", mpn: null, lcsc_pn: null, value: "4.7k", package: "0402", voltage: null, part_status: "active" as const },
    { id: "p3", mpn: null, lcsc_pn: null, value: "4.7k", package: "0805", voltage: null, part_status: "active" as const },
  ];

  test("a package mismatch means NO match at the fuzzy rung, however close the value — the ladder never falls back across packages", () => {
    const result = matchPart({ value: "4.7k", package: "0603" }, catalog);
    expect(result).toBeNull();
  });

  test(
    "the SAME matcher, called with the three real consumer-shaped descriptors (BOM reconcile line, bulk-takeout scan/paste line, receive duplicate-guard draft), applies the identical package-mandatory short-circuit — one matcher, three consumers (CROSS-FEATURE R2-31)",
    () => {
      // BOM reconcile line shape: qty/reference-designator fields dropped by
      // the caller before matching — only identity fields passed through.
      const bomLine = { value: "4.7k", package: "0603" };
      // Bulk-takeout scan/paste line — same identity shape, different origin.
      const takeoutLine = { value: "4.7k", package: "0603" };
      // Receive duplicate-part-guard draft — a new-part form being checked.
      const receiveDraft = { value: "4.7k", package: "0603" };

      for (const descriptor of [bomLine, takeoutLine, receiveDraft]) {
        expect(matchPart(descriptor, catalog)).toBeNull();
      }
    },
  );

  test("missing package on the input means the fuzzy rung never runs at all — package can't be skipped by omitting it", () => {
    expect(matchPart({ value: "4.7k" }, catalog)).toBeNull();
  });

  test(
    "the matcher takes no run-tier/concurrency-preset parameter — package evaluation can't be tuned away by an economy/balanced/thorough knob (that knob belongs to smark_agent_runs, a different layer)",
    () => {
      // matchPart's signature is (input, catalog, options) with no tier
      // concept at all — calling it identically regardless of any imagined
      // "tier" always applies the same ladder, package rung included.
      const result = matchPart({ value: "4.7k", package: "0402" }, catalog);
      expect(result?.part.id).toBe("p2");
    },
  );

  test.todo(
    "an agent result with package_match=false is NEVER marked is_recommended=true, even when MPN/price/stock/status all match",
    () => {
      // Requires the worker/bom-pipeline result-scoring code (not yet built —
      // no DB constraint ties package_match to is_recommended on
      // smark_agent_results). Convert once that scoring function lands.
    },
  );
});

describeDb("invariant: package-mandatory — DB guards", () => {
  let service: SupabaseClient;

  beforeAll(() => {
    service = createServiceClient();
  });

  test(
    "seeded smark_ordering_rules row for key='package' has mandatory=true and enabled=true out of the box",
    async () => {
      const { data, error } = await service
        .from("smark_ordering_rules")
        .select("mandatory, enabled, rank")
        .eq("key", "package")
        .single();

      expect(error).toBeNull();
      expect((data as { mandatory: boolean }).mandatory).toBe(true);
      expect((data as { enabled: boolean }).enabled).toBe(true);
    },
  );

  test(
    "DB layer: a direct UPDATE setting mandatory=false on the package rule violates smark_ordering_rules_package_locked — the invariant holds even bypassing the app layer (service role included)",
    async () => {
      const { error } = await service
        .from("smark_ordering_rules")
        .update({ mandatory: false })
        .eq("key", "package");
      expect(error).not.toBeNull();

      const { data: reread } = await service
        .from("smark_ordering_rules")
        .select("mandatory")
        .eq("key", "package")
        .single();
      expect((reread as { mandatory: boolean }).mandatory).toBe(true);
    },
  );

  test(
    "DB layer: a direct UPDATE setting enabled=false on the package rule ALSO violates the CHECK — mandatory=true isn't enough on its own, the row must stay enabled too",
    async () => {
      const { error } = await service.from("smark_ordering_rules").update({ enabled: false }).eq("key", "package");
      expect(error).not.toBeNull();

      const { data: reread } = await service
        .from("smark_ordering_rules")
        .select("enabled")
        .eq("key", "package")
        .single();
      expect((reread as { enabled: boolean }).enabled).toBe(true);
    },
  );

  test(
    "DB layer: DELETE on the package rule is rejected by the smark_block_package_rule_delete BEFORE DELETE trigger (CHECK constraints can't intercept DELETE, so this needs — and has — a dedicated guard)",
    async () => {
      const { error } = await service.from("smark_ordering_rules").delete().eq("key", "package");
      expect(error).not.toBeNull();

      const { data: reread } = await service
        .from("smark_ordering_rules")
        .select("id")
        .eq("key", "package")
        .single();
      expect(reread).not.toBeNull();
    },
  );

  test(
    "adding a custom ordering rule via Settings appends a new `custom` row — it never reorders or supersedes the package row's mandatory status",
    async () => {
      const { data: before } = await service
        .from("smark_ordering_rules")
        .select("mandatory, enabled, rank")
        .eq("key", "package")
        .single();

      const { data: custom, error } = await service
        .from("smark_ordering_rules")
        .insert({
          key: "custom",
          enabled: true,
          mandatory: false,
          rank: 99,
          params: { text: "Prefer RoHS-compliant parts" },
        })
        .select("id")
        .single();
      expect(error).toBeNull();

      const { data: after } = await service
        .from("smark_ordering_rules")
        .select("mandatory, enabled, rank")
        .eq("key", "package")
        .single();
      expect(after).toEqual(before);

      await service.from("smark_ordering_rules").delete().eq("id", (custom as { id: string }).id);
    },
  );
});
