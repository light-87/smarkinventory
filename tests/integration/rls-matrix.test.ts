import { describe, test } from "bun:test";

/**
 * RLS matrix as executable spec — plan/TESTING.md §2 "DB / RLS" layer.
 * Canonical matrix: FEATURES.md §2 + plan/SCHEMA.md "RLS matrix — FINAL [Q-01]".
 *
 * Runs against the LOCAL Supabase stack (CI: supabase db reset; dev: bunx
 * supabase start). One client per role via tests/helpers/supabase.ts
 * `createRoleClient`, asserting allow AND deny per cell — UI hiding is never
 * the enforcement (FEATURES.md §2: "enforced twice").
 *
 * Skeleton (test.todo) until the supabase package lands migrations + seeded
 * role users. Convert todos to real tests in place — keep the names.
 */

describe("RLS matrix [R2-01 · Q-01 FINAL]", () => {
  describe("owner", () => {
    test.todo("owner: full read+write on every smark_ table", () => {});
    test.todo("owner: can INSERT/UPDATE smark_app_users (create, deactivate)", () => {});
    test.todo("owner: can approve/retire smark_learned_rules and bump smark_learned_rules_doc", () => {});
    test.todo("owner: can write Settings tables (ordering_rules, distributors, expense_accounts)", () => {});
  });

  describe("employee", () => {
    test.todo("employee: read+write operational tables (parts, stock_locations, movements, boms, runs, cart, feedback, activities)", () => {});
    test.todo("employee: can write OWN attendance + time entries only (auth.uid() = user_id)", () => {});
    test.todo("employee: DENIED read of others' attendance/time entries (Daily Reports self-only)", () => {});
    test.todo("employee: DENIED SELECT on smark_expenses and v_expense_rollups (hidden, not read-only)", () => {});
    test.todo("employee: DENIED writes to Settings tables (ordering_rules, distributors, expense_accounts, app_users)", () => {});
    test.todo("employee: DENIED approving smark_learned_rules (UPDATE status suggested→active rejected)", () => {});
    test.todo("employee: DENIED user management (INSERT/UPDATE smark_app_users)", () => {});
  });

  describe("accountant", () => {
    test.todo("accountant: read-only operational tables — SELECT allowed, INSERT/UPDATE/DELETE denied (parts, movements, boms, cart, orders)", () => {});
    test.todo("accountant: read + WRITE smark_expenses (Q-01 client amendment)", () => {});
    test.todo("accountant: SELECT smark_expense_accounts allowed, writes denied (owner-only CRUD)", () => {});
    test.todo("accountant: reads ALL attendance/time/daily data (read-all, write none)", () => {});
    test.todo("accountant: DENIED Settings tables and learned-rule approval", () => {});
  });

  describe("shared / structural", () => {
    test.todo("smark_app_users readable by every authenticated role (names render in history)", () => {});
    test.todo("every mutation stamps the real user_id (created_by/actor = auth.uid(), not spoofable)", () => {});
    test.todo("deactivated user (active=false) is blocked from all reads/writes", () => {});
    test.todo("anonymous key: DENIED on all smark_ tables directly", () => {});
  });

  describe("client portal (tokenized public surface, not a role) [R2-38]", () => {
    test.todo("portal security-definer fn returns ONLY name/status/phases/progress + explicitly-shared items for a valid share_token", () => {});
    test.todo("share_token grants ZERO direct table-level access (all raw selects denied)", () => {});
    test.todo("invalid or regenerated token resolves nothing (regenerate = revoke)", () => {});
    test.todo("archived project's token stops resolving [R2-32]", () => {});
    test.todo("portal comment INSERT lands as 'change' activity tagged from-portal; any other INSERT denied", () => {});
    test.todo("portal payload NEVER contains prices, inventory, hours, or internal notes (leak scan)", () => {});
  });
});
