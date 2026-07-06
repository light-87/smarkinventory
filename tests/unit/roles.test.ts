import { describe, expect, test } from "bun:test";
import {
  AREAS,
  type Access,
  type Area,
  ROLES,
  ROLE_MATRIX,
  RoleSchema,
  accessFor,
  canApproveRules,
  canManageUsers,
  canSee,
  canWrite,
  dataScope,
  emailToUsername,
  isOwner,
  usernameToEmail,
  visibleAreas,
} from "@/lib/auth/roles";

/**
 * lib/auth/roles — the FEATURES.md §2 role matrix as code (Q-01 FINAL).
 * This suite is also the executable copy of that matrix: any drift in
 * `ROLE_MATRIX` away from the documented table fails loudly here, mirroring
 * plan/TESTING.md's RLS-matrix-as-executable-spec approach on the DB side.
 */

describe("ROLES", () => {
  test("exactly owner, employee, accountant, in matrix order", () => {
    expect(ROLES).toEqual(["owner", "employee", "accountant"]);
  });
});

describe("ROLE_MATRIX — verbatim FEATURES.md §2 / SCHEMA.md RLS matrix", () => {
  // Rows 1–2 + row 5's owner-only surfaces come straight from the FEATURES §2
  // table; `users` is the SCHEMA.md "RLS matrix — FINAL" split-out. Expenses
  // and expense_accounts were removed as gateable Areas along with the
  // Expenses tab/UI — see lib/orders/expense-write.ts for the standalone
  // write-permission check checkout.ts uses in their place.
  const expected: Record<Area, Record<(typeof ROLES)[number], Access>> = {
    dashboard: { owner: "full", employee: "full", accountant: "read" },
    inventory: { owner: "full", employee: "full", accountant: "read" },
    shelves: { owner: "full", employee: "full", accountant: "read" },
    scan: { owner: "full", employee: "full", accountant: "read" },
    bulk_takeout: { owner: "full", employee: "full", accountant: "read" },
    receive: { owner: "full", employee: "full", accountant: "read" },
    projects: { owner: "full", employee: "full", accountant: "read" },
    cart: { owner: "full", employee: "full", accountant: "read" },
    daily_reports: { owner: "full", employee: "self", accountant: "read" },
    attendance: { owner: "full", employee: "self", accountant: "read" },
    ai_memory: { owner: "full", employee: "hidden", accountant: "hidden" },
    settings: { owner: "full", employee: "hidden", accountant: "hidden" },
    users: { owner: "full", employee: "hidden", accountant: "hidden" },
    // (0011) "My Profile" — every role only ever sees/edits their OWN row here.
    profile: { owner: "self", employee: "self", accountant: "self" },
    // Owner-only PM analytics dashboard — hidden entirely for employee/accountant.
    project_dashboard: { owner: "full", employee: "hidden", accountant: "hidden" },
  };

  test("every area is covered by AREAS (no silent gaps)", () => {
    expect(new Set(AREAS)).toEqual(new Set(Object.keys(expected) as Area[]));
  });

  test.each(Array.from(AREAS))("%s matches the documented matrix exactly", (area) => {
    expect(ROLE_MATRIX[area]).toEqual(expected[area]);
  });

  test("owner is 'full' everywhere except the self-service 'profile' area (own row only, by design)", () => {
    for (const area of AREAS) {
      if (area === "profile") {
        expect(ROLE_MATRIX[area].owner).toBe("self");
      } else {
        expect(ROLE_MATRIX[area].owner).toBe("full");
      }
    }
  });

  test("employee is fully hidden from Settings, user mgmt, and AI-memory approval", () => {
    expect(ROLE_MATRIX.settings.employee).toBe("hidden");
    expect(ROLE_MATRIX.users.employee).toBe("hidden");
    expect(ROLE_MATRIX.ai_memory.employee).toBe("hidden");
  });

  test("employee and accountant are fully hidden from the Project Dashboard", () => {
    expect(ROLE_MATRIX.project_dashboard.employee).toBe("hidden");
    expect(ROLE_MATRIX.project_dashboard.accountant).toBe("hidden");
    expect(ROLE_MATRIX.project_dashboard.owner).toBe("full");
  });

  test("accountant is read-only everywhere it can see (never write ops/projects/cart)", () => {
    const readOnlyAreas: Area[] = [
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
    ];
    for (const area of readOnlyAreas) {
      expect(ROLE_MATRIX[area].accountant).toBe("read");
    }
  });

  test("daily reports: owner sees all people, employee self only, accountant read all", () => {
    expect(ROLE_MATRIX.daily_reports).toEqual({ owner: "full", employee: "self", accountant: "read" });
  });
});

describe("accessFor", () => {
  test("reads straight from the matrix", () => {
    expect(accessFor("owner", "settings")).toBe("full");
    expect(accessFor("employee", "daily_reports")).toBe("self");
    expect(accessFor("accountant", "dashboard")).toBe("read");
  });
});

describe("canSee", () => {
  test("true for full/read/self, false for hidden", () => {
    expect(canSee("owner", "settings")).toBe(true);
    expect(canSee("accountant", "inventory")).toBe(true);
    expect(canSee("employee", "daily_reports")).toBe(true);
    expect(canSee("employee", "settings")).toBe(false);
    expect(canSee("accountant", "ai_memory")).toBe(false);
  });
});

describe("canWrite", () => {
  test("true for full and self, false for read and hidden", () => {
    expect(canWrite("owner", "inventory")).toBe(true); // full
    expect(canWrite("employee", "daily_reports")).toBe(true); // self
    expect(canWrite("accountant", "inventory")).toBe(false); // read
    expect(canWrite("employee", "settings")).toBe(false); // hidden
  });
});

describe("dataScope", () => {
  test("full and read both see ALL rows (row-visibility is unrestricted; write differs, not scope)", () => {
    expect(dataScope("owner", "dashboard")).toBe("all");
    expect(dataScope("accountant", "inventory")).toBe("all");
  });

  test("self scopes to the caller's own rows", () => {
    expect(dataScope("employee", "daily_reports")).toBe("self");
  });

  test("hidden areas scope to none", () => {
    expect(dataScope("employee", "settings")).toBe("none");
  });
});

describe("visibleAreas", () => {
  test("owner sees every area", () => {
    expect(visibleAreas("owner")).toEqual([...AREAS]);
  });

  test("employee is missing ai_memory, settings, users", () => {
    const hidden = visibleAreas("employee");
    expect(hidden).not.toContain("ai_memory");
    expect(hidden).not.toContain("settings");
    expect(hidden).not.toContain("users");
    expect(hidden).toContain("daily_reports");
  });

  test("accountant is missing only ai_memory, settings, users", () => {
    const areas = visibleAreas("accountant");
    expect(areas).not.toContain("ai_memory");
    expect(areas).not.toContain("settings");
    expect(areas).not.toContain("users");
    expect(areas).toContain("dashboard");
  });

  test("returned in nav order (AREAS order), not alphabetical or role-specific order", () => {
    const areas = visibleAreas("accountant");
    const expectedOrder = AREAS.filter((a) => areas.includes(a));
    expect(areas).toEqual(expectedOrder);
  });
});

describe("isOwner / canApproveRules / canManageUsers", () => {
  test("isOwner is true only for 'owner'", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("employee")).toBe(false);
    expect(isOwner("accountant")).toBe(false);
  });

  test("canApproveRules — suggested rules never auto-active (A3); only the owner approves", () => {
    expect(canApproveRules("owner")).toBe(true);
    expect(canApproveRules("employee")).toBe(false);
    expect(canApproveRules("accountant")).toBe(false);
  });

  test("canManageUsers — only the owner manages Settings → Users", () => {
    expect(canManageUsers("owner")).toBe(true);
    expect(canManageUsers("employee")).toBe(false);
    expect(canManageUsers("accountant")).toBe(false);
  });
});

describe("username <-> synthetic email (FEATURES §2: username+password, no email flows)", () => {
  test("usernameToEmail trims, lowercases, appends @smark.internal", () => {
    expect(usernameToEmail("Sanjay.R")).toBe("sanjay.r@smark.internal");
    expect(usernameToEmail("  Owner1  ")).toBe("owner1@smark.internal");
  });

  test("emailToUsername strips the domain", () => {
    expect(emailToUsername("sanjay.r@smark.internal")).toBe("sanjay.r");
  });

  test("emailToUsername is defensive against a bare username with no @", () => {
    expect(emailToUsername("noatsign")).toBe("noatsign");
  });

  test("round-trips", () => {
    expect(emailToUsername(usernameToEmail("Owner1"))).toBe("owner1");
  });
});

describe("RoleSchema (re-export of AppRoleSchema — single source of truth with types/db.ts)", () => {
  test("accepts the three valid roles", () => {
    for (const role of ROLES) {
      expect(RoleSchema.parse(role)).toBe(role);
    }
  });

  test("rejects anything else", () => {
    expect(RoleSchema.safeParse("admin").success).toBe(false);
    expect(RoleSchema.safeParse("").success).toBe(false);
    expect(RoleSchema.safeParse(undefined).success).toBe(false);
  });
});
