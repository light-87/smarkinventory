import { describe, expect, test } from "bun:test";
import { checkRuleRemovable, nextRank } from "@/lib/settings/rules";
import { isRulePinned, labelForRule } from "@/lib/settings/types";
import type { OrderingRuleRow } from "@/types/db";

/**
 * lib/settings/rules — the app-level guard in front of the DB's own
 * protection (migration 0004: `smark_ordering_rules_package_locked` CHECK +
 * `trg_smark_ordering_rules_protect_package` BEFORE DELETE trigger). Same
 * function `removeOrderingRuleAction` (lib/settings/actions.ts) calls before
 * ever touching Supabase — this is the "assert the action refuses" test for
 * the package-pinned rule (plan/tab-settings.md, FEATURES.md §7).
 */

function rule(overrides: Partial<Pick<OrderingRuleRow, "key" | "mandatory" | "params">> = {}): Pick<
  OrderingRuleRow,
  "key" | "mandatory"
> {
  return { key: "mpn", mandatory: false, ...overrides };
}

describe("checkRuleRemovable — package rung is pinned", () => {
  test("refuses the package rule (key=package, mandatory=true, per seed.sql)", () => {
    const result = checkRuleRemovable(rule({ key: "package", mandatory: true }));
    expect(result.removable).toBe(false);
    expect(result.reason).toMatch(/mandatory/i);
    expect(result.reason).toMatch(/never substitutable/i);
  });

  test("refuses ANY row flagged mandatory, even if the key were somehow not 'package'", () => {
    // Defense in depth: the guard reads `mandatory`, not just the key literal —
    // matches the DB CHECK's own predicate (`key <> 'package' or (mandatory and enabled)`).
    const result = checkRuleRemovable(rule({ key: "mpn", mandatory: true }));
    expect(result.removable).toBe(false);
  });

  test("allows removing every OTHER standard rung", () => {
    for (const key of ["mpn", "lcsc", "value", "status", "qty", "cost"] as const) {
      expect(checkRuleRemovable(rule({ key, mandatory: false })).removable).toBe(true);
    }
  });

  test("allows removing a custom rule", () => {
    expect(checkRuleRemovable(rule({ key: "custom", mandatory: false })).removable).toBe(true);
  });
});

describe("isRulePinned", () => {
  test("true only for package/mandatory rows", () => {
    expect(isRulePinned({ key: "package", mandatory: true })).toBe(true);
    expect(isRulePinned({ key: "mpn", mandatory: false })).toBe(false);
    expect(isRulePinned({ key: "custom", mandatory: false })).toBe(false);
  });
});

describe("labelForRule", () => {
  const base = { id: "1", created_at: "2026-01-01T00:00:00Z", updated_at: null, rank: 1, enabled: true, created_by: null };

  test("standard rungs use the fixed FEATURES.md §7 copy", () => {
    const row = { ...base, key: "package" as const, mandatory: true, params: null };
    expect(labelForRule(row)).toMatch(/mandatory, never substitutable/i);
  });

  test("custom rows render their own free-text label from params", () => {
    const row = { ...base, key: "custom" as const, mandatory: false, params: { label: "Prefer RoHS-compliant parts" } };
    expect(labelForRule(row)).toBe("Prefer RoHS-compliant parts");
  });

  test("a malformed/missing custom label falls back instead of throwing", () => {
    const row = { ...base, key: "custom" as const, mandatory: false, params: null };
    expect(labelForRule(row)).toBe("Custom rule");
  });
});

describe("nextRank", () => {
  test("1 for an empty ladder", () => {
    expect(nextRank([])).toBe(1);
  });

  test("max + 1, tolerating gaps left by earlier removals", () => {
    expect(nextRank([1, 2, 4])).toBe(5);
  });
});
