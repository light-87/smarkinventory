/**
 * lib/auth/roles.ts — the FEATURES.md §2 role matrix as code.
 *
 * Single source of truth for UI gating (nav items, buttons, route guards).
 * RLS policies are the DB twin of this matrix (plan/SCHEMA.md "RLS matrix —
 * FINAL"); the two are kept in sync by the RLS matrix test suite
 * (plan/TESTING.md layer 3). If you change anything here, the RLS policies
 * and tests/unit/roles.test.ts must move with it.
 *
 * §2 matrix (Q-01 FINAL):
 * | Area                                                    | Owner | Employee  | Accountant   |
 * |---------------------------------------------------------|-------|-----------|--------------|
 * | Dashboard · Inventory · Shelves · Scan · Bulk takeout · Receive | full  | full      | read-only    |
 * | Projects (BOMs, runs, review, cart-add) · Cart & checkout       | full  | full      | read-only    |
 * | Daily Reports                                                   | all   | self only | read all     |
 * | Expenses (+charts, AI spend)                                    | full  | hidden    | read + write |
 * | AI Memory approve · Settings · user management                  | full  | hidden    | hidden       |
 */

import { AppRoleSchema, type AppRole } from "@/types/db";

export type Role = AppRole;
export { AppRoleSchema as RoleSchema };
export const ROLES: readonly Role[] = AppRoleSchema.options;

/**
 * App areas = the gateable surfaces (nav truth, FEATURES §5).
 * `expense_accounts` is split out because the accountant writes expense
 * ENTRIES but only reads accounts (owner-only CRUD, SCHEMA §7 [R2-28]).
 */
export const AREAS = [
  "dashboard",
  "inventory",
  "shelves",
  "scan",
  "bulk_takeout",
  "receive",
  "projects",
  "cart",
  "daily_reports",
  "expenses",
  "expense_accounts",
  "ai_memory",
  "settings",
  "users",
] as const;
export type Area = (typeof AREAS)[number];

/**
 * Access levels:
 *  - `full`   — see everything in the area, mutate everything.
 *  - `read`   — see everything, mutate nothing.
 *  - `self`   — see + mutate ONLY rows about yourself (employee ↔ Daily Reports:
 *               own attendance, own hours, own day view).
 *  - `hidden` — area does not exist for this role (nav item hidden, route 404s).
 */
export type Access = "full" | "read" | "self" | "hidden";

/** The matrix, verbatim from FEATURES.md §2. */
export const ROLE_MATRIX: Record<Area, Record<Role, Access>> = {
  // Row 1 — operational inventory surfaces
  dashboard: { owner: "full", employee: "full", accountant: "read" },
  inventory: { owner: "full", employee: "full", accountant: "read" },
  shelves: { owner: "full", employee: "full", accountant: "read" },
  scan: { owner: "full", employee: "full", accountant: "read" },
  bulk_takeout: { owner: "full", employee: "full", accountant: "read" },
  receive: { owner: "full", employee: "full", accountant: "read" },
  // Row 2 — projects + cart
  projects: { owner: "full", employee: "full", accountant: "read" },
  cart: { owner: "full", employee: "full", accountant: "read" },
  // Row 3 — Daily Reports: owner all people, employee self only, accountant read all
  daily_reports: { owner: "full", employee: "self", accountant: "read" },
  // Row 4 — Expenses: accountant read + WRITE (Q-01 client amendment)
  expenses: { owner: "full", employee: "hidden", accountant: "full" },
  expense_accounts: { owner: "full", employee: "hidden", accountant: "read" },
  // Row 5 — owner-only
  ai_memory: { owner: "full", employee: "hidden", accountant: "hidden" },
  settings: { owner: "full", employee: "hidden", accountant: "hidden" },
  users: { owner: "full", employee: "hidden", accountant: "hidden" },
};

/**
 * Raw access level for a (role, area) pair.
 *
 * `role` is `Role | null | undefined` on purpose: `smark_role()` returns SQL
 * NULL for anon, unknown, or DEACTIVATED callers (types/db.ts
 * Functions.smark_role.Returns = `AppRole | null`). A null OR otherwise
 * unrecognized role is DENIED everything ("hidden") — never silently granted.
 * Without this guard the lookup is `undefined`, and `undefined !== "hidden"`
 * would make canSee/canWrite return true for a role-less caller.
 */
export function accessFor(role: Role | null | undefined, area: Area): Access {
  if (role == null) return "hidden";
  const access: Access | undefined = ROLE_MATRIX[area][role];
  return access ?? "hidden";
}

/** Can this role see the area at all? (nav visibility / route guard) */
export function canSee(role: Role, area: Area): boolean {
  return accessFor(role, area) !== "hidden";
}

/**
 * Can this role mutate data in the area?
 * `self` counts as writable — but ONLY for the caller's own rows; pair with
 * `dataScope()` when building queries/actions.
 */
export function canWrite(role: Role, area: Area): boolean {
  const a = accessFor(role, area);
  return a === "full" || a === "self";
}

/**
 * Row visibility scope inside an area the role can see:
 *  - `all`  — every row (owner everywhere; accountant read-all).
 *  - `self` — only rows where the subject user is the caller.
 *  - `none` — area hidden.
 */
export function dataScope(role: Role, area: Area): "all" | "self" | "none" {
  const a = accessFor(role, area);
  if (a === "hidden") return "none";
  return a === "self" ? "self" : "all";
}

/** Areas visible to a role, in nav order — feeds rail / More-sheet filtering. */
export function visibleAreas(role: Role): Area[] {
  return AREAS.filter((area) => canSee(role, area));
}

/** Convenience guards used across feature packages. */
export const isOwner = (role: Role): boolean => role === "owner";

/** Only the owner approves AI-memory rules (A3: suggested never auto-active). */
export const canApproveRules = (role: Role): boolean =>
  accessFor(role, "ai_memory") === "full";

/** Only the owner manages users (Settings → Users & roles). */
export const canManageUsers = (role: Role): boolean =>
  accessFor(role, "users") === "full";

/**
 * Username ↔ synthetic email mapping (FEATURES §2): Supabase Auth stores
 * `{username}@smark.internal`; the visible identity stays the plain username.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "smark.internal";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function emailToUsername(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}
