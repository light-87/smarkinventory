import { describe, test } from "bun:test";

/**
 * DB layer beyond RLS — plan/TESTING.md §2: "migrations apply cleanly;
 * FK/unique constraints; triggers/views".
 * Canonical shapes: plan/SCHEMA.md (tables §0–7, views §8, sync table at end).
 *
 * Runs against the LOCAL stack after `supabase db reset` (the reset itself is
 * the "migrations apply cleanly" gate — CI fails the job if it errors).
 * Skeleton (test.todo) until the supabase package lands migrations.
 */

describe("migrations & constraints", () => {
  test.todo("supabase db reset applies all migrations + seed without error (asserted by querying every smark_ table exists)", () => {});
  test.todo("all tables carry uuid PK id, created_at default now(), updated_at (SCHEMA.md conventions)", () => {});
  test.todo("UNIQUE: smark_boms (project_id, name) — BOM name unique per project [R2-03]", () => {});
  test.todo("UNIQUE: smark_orders.po_number — website order number [R2-12/Q-06]", () => {});
  test.todo("UNIQUE: smark_attendance (user_id, work_date)", () => {});
  test.todo("UNIQUE: smark_project_members (project_id, user_id)", () => {});
  test.todo("UNIQUE: smark_projects.share_token and smark_ai_aliases.alias", () => {});
  test.todo("CHECK: smark_app_users.role IN (owner, employee, accountant)", () => {});
  test.todo("FK: actor/created_by/started_by/uploaded_by/placed_by → smark_app_users.id [R2-01]", () => {});
  test.todo("deactivate-not-delete: deleting a smark_app_users row with history is rejected (FK restrict)", () => {});
});

describe("views (plan/SCHEMA.md §8)", () => {
  describe("v_part_demand [R2-10 · Q-05 FINAL]", () => {
    test.todo("demand = Σ(line qty × bom.build_qty) over matched lines of active, reconciled BOMs [R2-27]", () => {});
    test.todo("excludes BOMs of archived projects (archive releases demand) [R2-32]", () => {});
    test.todo("shortfall = GREATEST(demand − available, 0), available = smark_parts.total_qty", () => {});
    test.todo("per-project demand breakdown matches seeded BOMs", () => {});
  });

  describe("v_daily_activity [R2-07]", () => {
    test.todo("unions movements ∪ part events ∪ run starts/finishes ∪ cart adds ∪ orders ∪ arrivals per (actor, day)", () => {});
    test.todo("joins attendance + time entries per person; read-only (no write path)", () => {});
  });

  describe("v_expense_rollups [R2-21]", () => {
    test.todo("monthly/quarterly/yearly sums by type, category, account, project equal seeded sums", () => {});
    test.todo("draft expenses (is_draft=true) and soft-deleted rows excluded from rollups", () => {});
  });
});

describe("denormalized sync points (SCHEMA.md 'keep in sync' table)", () => {
  test.todo("smark_parts.total_qty recomputes on every movement/receive/adjust (trigger)", () => {});
  test.todo("BOM sourcing_status follows its latest agent run; project card status derives from its BOMs [R2-03]", () => {});
});
