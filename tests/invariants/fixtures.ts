import { describe } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasLocalSupabase } from "../helpers/supabase";

/**
 * tests/invariants/fixtures.ts — runtime DB fixtures shared by the
 * invariants+e2e package's DB-backed suites (undo-pairing, qty-rollup,
 * print-rule, package-mandatory).
 *
 * Why runtime fixtures instead of a static `tests/fixtures/seed-test.sql`:
 * CI's "migrations apply cleanly" step is `supabase db reset`, which applies
 * `supabase/migrations/**` + the ONE locked `supabase/seed.sql`
 * (docs/OWNERSHIP.md "Shared — integrator only" — this package cannot add a
 * second file to that apply step without a CI/workflow change, which is also
 * integrator-locked). `supabase/seed.sql` is deliberately config-only (no
 * demo rows — see its own header) and no role users exist yet (auth-shell's
 * package seeds those). So every DB-backed test here creates the tiny slice
 * of data it needs (an auth user + `smark_app_users` row, a shelf/box, a
 * part) through the SERVICE-ROLE client at test time, and tears it down
 * afterwards — self-contained, works today, and never depends on load order
 * relative to other packages' seed data.
 *
 * Gate: `describeDb` = `describe` when a local Supabase stack is configured
 * AND the caller hasn't opted out via `SKIP_DB_TESTS=1` (CI resilience knob
 * asked for by the invariants+e2e mission — e.g. a fast local iteration loop
 * without Docker running, or a CI job that wants to skip DB suites on
 * purpose). Mirrors `tests/helpers/supabase.ts`'s `describeWithDb` shape
 * exactly (same `describe` vs `describe.skip` reference-check contract) but
 * lives here because `tests/helpers/**` is integrator-locked
 * (docs/OWNERSHIP.md).
 */
export const dbTestsEnabled = hasLocalSupabase && process.env.SKIP_DB_TESTS !== "1";
export const describeDb = dbTestsEnabled ? describe : describe.skip;

/** Short, collision-resistant suffix for fixture names within one test run. */
function tag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface TestActor {
  id: string;
  role: "owner" | "employee" | "accountant";
  cleanup: () => Promise<void>;
}

/**
 * Creates a real `auth.users` row (via the admin API) + its `smark_app_users`
 * profile, so fixtures can satisfy `smark_movements.actor` (NOT NULL FK) and
 * other actor/created_by columns. Service-role only — never use this pattern
 * in app code (admin.createUser is a privileged operation).
 */
export async function createTestActor(
  service: SupabaseClient,
  role: TestActor["role"] = "owner",
): Promise<TestActor> {
  const suffix = tag();
  const email = `invariant-${suffix}@smark.internal`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: "Invariant-Test-Pass-1!",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`fixtures: createTestActor auth.admin.createUser failed: ${error?.message}`);
  }
  const userId = data.user.id;

  const { error: profileError } = await service.from("smark_app_users").insert({
    id: userId,
    username: `invtest_${suffix}`,
    display_name: "Invariant Test Actor",
    role,
    active: true,
  });
  if (profileError) {
    await service.auth.admin.deleteUser(userId);
    throw new Error(`fixtures: createTestActor smark_app_users insert failed: ${profileError.message}`);
  }

  return {
    id: userId,
    role,
    cleanup: async () => {
      await service.from("smark_app_users").delete().eq("id", userId);
      await service.auth.admin.deleteUser(userId);
    },
  };
}

export interface TestBox {
  shelfId: string;
  boxId: string;
  cleanup: () => Promise<void>;
}

/** Creates a throwaway shelf + big box (for `smark_stock_locations` FKs). */
export async function createTestBox(service: SupabaseClient): Promise<TestBox> {
  const suffix = tag();

  const { data: shelf, error: shelfError } = await service
    .from("smark_shelves")
    .insert({ code: `T${suffix}` })
    .select("id")
    .single();
  if (shelfError || !shelf) {
    throw new Error(`fixtures: createTestBox shelf insert failed: ${shelfError?.message}`);
  }

  const { data: box, error: boxError } = await service
    .from("smark_big_boxes")
    .insert({ shelf_id: (shelf as { id: string }).id, name: `BOX-${suffix}` })
    .select("id")
    .single();
  if (boxError || !box) {
    await service.from("smark_shelves").delete().eq("id", (shelf as { id: string }).id);
    throw new Error(`fixtures: createTestBox box insert failed: ${boxError?.message}`);
  }

  return {
    shelfId: (shelf as { id: string }).id,
    boxId: (box as { id: string }).id,
    cleanup: async () => {
      await service.from("smark_big_boxes").delete().eq("id", (box as { id: string }).id);
      await service.from("smark_shelves").delete().eq("id", (shelf as { id: string }).id);
    },
  };
}

export interface TestPart {
  id: string;
  cleanup: () => Promise<void>;
}

/** Creates a throwaway `smark_parts` row. */
export async function createTestPart(
  service: SupabaseClient,
  overrides: Record<string, unknown> = {},
): Promise<TestPart> {
  const suffix = tag();
  const { data, error } = await service
    .from("smark_parts")
    .insert({
      internal_pid: `SMKTEST-${suffix}`,
      part_status: "active",
      attributes: {},
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`fixtures: createTestPart insert failed: ${error?.message}`);
  }
  const id = (data as { id: string }).id;
  return {
    id,
    cleanup: async () => {
      await service.from("smark_stock_locations").delete().eq("part_id", id);
      await service.from("smark_movements").delete().eq("part_id", id);
      await service.from("smark_qr_labels").delete().eq("target_id", id).eq("target_type", "part");
      await service.from("smark_parts").delete().eq("id", id);
    },
  };
}

/** Reads a single part's `total_qty` straight from the DB (the rollup under test). */
export async function readTotalQty(service: SupabaseClient, partId: string): Promise<number> {
  const { data, error } = await service
    .from("smark_parts")
    .select("total_qty")
    .eq("id", partId)
    .single();
  if (error || !data) {
    throw new Error(`fixtures: readTotalQty failed: ${error?.message}`);
  }
  return (data as { total_qty: number }).total_qty;
}

/** Sums `smark_stock_locations.qty` for a part directly (the rollup's source of truth). */
export async function sumLocationQty(service: SupabaseClient, partId: string): Promise<number> {
  const { data, error } = await service
    .from("smark_stock_locations")
    .select("qty")
    .eq("part_id", partId);
  if (error || !data) {
    throw new Error(`fixtures: sumLocationQty failed: ${error?.message}`);
  }
  return (data as Array<{ qty: number }>).reduce((sum, row) => sum + row.qty, 0);
}
