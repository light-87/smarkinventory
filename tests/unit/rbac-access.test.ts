import { describe, expect, test } from "bun:test";
import { AREAS } from "@/lib/auth/roles";
import { effectiveAreasForUser, effectiveCanSee, isGrantableArea } from "@/lib/rbac/access";
import { GRANTABLE_AREAS, MODULE_AREAS } from "@/lib/rbac/types";

/**
 * lib/rbac/access — the additive employee-only gate on top of
 * lib/auth/roles' canSee (migration 0013). Mirrors tests/unit/roles.test.ts'
 * approach: this suite is the executable copy of the "owner/accountant
 * unaffected, employee gated to granted modules" rule.
 */

describe("isGrantableArea", () => {
  test("true for every Area bundled into a module", () => {
    for (const area of GRANTABLE_AREAS) {
      expect(isGrantableArea(area)).toBe(true);
    }
  });

  test("false for ungated areas (dashboard, daily_reports, settings, users, profile, ai_memory, project_dashboard)", () => {
    const ungated = ["dashboard", "daily_reports", "settings", "users", "profile", "ai_memory", "project_dashboard"] as const;
    for (const area of ungated) {
      expect(isGrantableArea(area)).toBe(false);
    }
  });
});

describe("effectiveCanSee — owner/accountant unaffected", () => {
  test("owner sees every area regardless of (empty) grants — grants are never even consulted", () => {
    for (const area of AREAS) {
      expect(effectiveCanSee("owner", area, [])).toBe(true);
    }
  });

  test("accountant sees exactly what canSee already gives it, regardless of grants", () => {
    expect(effectiveCanSee("accountant", "inventory", [])).toBe(true);
    expect(effectiveCanSee("accountant", "projects", [])).toBe(true);
    expect(effectiveCanSee("accountant", "attendance", [])).toBe(true);
    expect(effectiveCanSee("accountant", "settings", [])).toBe(false); // hidden regardless
  });
});

describe("effectiveCanSee — employee, no grants", () => {
  const grantedModules: never[] = [];

  test("sees only ungated areas: dashboard, daily_reports, profile", () => {
    expect(effectiveCanSee("employee", "dashboard", grantedModules)).toBe(true);
    expect(effectiveCanSee("employee", "daily_reports", grantedModules)).toBe(true);
    expect(effectiveCanSee("employee", "profile", grantedModules)).toBe(true);
  });

  test("does NOT see any grantable area", () => {
    for (const area of GRANTABLE_AREAS) {
      expect(effectiveCanSee("employee", area, grantedModules)).toBe(false);
    }
  });

  test("still hidden from owner-only areas (settings/users/ai_memory/project_dashboard), same as plain canSee", () => {
    expect(effectiveCanSee("employee", "settings", grantedModules)).toBe(false);
    expect(effectiveCanSee("employee", "users", grantedModules)).toBe(false);
    expect(effectiveCanSee("employee", "ai_memory", grantedModules)).toBe(false);
    expect(effectiveCanSee("employee", "project_dashboard", grantedModules)).toBe(false);
  });
});

describe("effectiveCanSee — employee, one module granted", () => {
  test("granting 'inventory' unlocks exactly its bundled areas, nothing else", () => {
    const grantedModules = ["inventory"] as const;
    for (const area of MODULE_AREAS.inventory) {
      expect(effectiveCanSee("employee", area, grantedModules)).toBe(true);
    }
    for (const area of MODULE_AREAS.project_management) {
      expect(effectiveCanSee("employee", area, grantedModules)).toBe(false);
    }
    for (const area of MODULE_AREAS.attendance) {
      expect(effectiveCanSee("employee", area, grantedModules)).toBe(false);
    }
  });

  test("granting 'project_management' unlocks 'projects' only — never project_dashboard (owner-only always)", () => {
    const grantedModules = ["project_management"] as const;
    expect(effectiveCanSee("employee", "projects", grantedModules)).toBe(true);
    expect(effectiveCanSee("employee", "project_dashboard", grantedModules)).toBe(false);
  });

  test("granting 'attendance' unlocks the attendance area", () => {
    expect(effectiveCanSee("employee", "attendance", ["attendance"])).toBe(true);
  });
});

describe("effectiveCanSee — revoking removes access", () => {
  test("granted then revoked (empty grants again) loses access to that module's areas", () => {
    const granted = ["inventory"] as const;
    const revoked: never[] = [];
    expect(effectiveCanSee("employee", "inventory", granted)).toBe(true);
    expect(effectiveCanSee("employee", "inventory", revoked)).toBe(false);
  });
});

describe("effectiveAreasForUser", () => {
  test("owner: identical to the full AREAS list", () => {
    expect(effectiveAreasForUser("owner", [])).toEqual([...AREAS]);
  });

  test("employee with no grants: only the ungated areas, in AREAS order", () => {
    const result = effectiveAreasForUser("employee", []);
    expect(result).toEqual(["dashboard", "daily_reports", "profile"]);
  });

  test("employee with all 3 modules granted: matches canSee-only visibility (every non-owner-only area)", () => {
    const result = effectiveAreasForUser("employee", ["inventory", "project_management", "attendance"]);
    expect(result).toEqual([
      "dashboard",
      "inventory",
      "shelves",
      "scan",
      "bulk_takeout",
      "receive",
      "projects",
      "cart",
      "daily_reports",
      "attendance",
      "profile",
    ]);
  });
});
