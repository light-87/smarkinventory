/**
 * lib/rbac/types.ts — module bundle definitions for per-employee grants
 * (Settings → Users → module permissions, migration 0013). A "module"
 * bundles several `Area`s from lib/auth/roles.ts; the owner grants/revokes
 * MODULES per employee, never per-Area directly. Kept separate from
 * types/db.ts (integrator-owned DB row contracts) — these are package-local
 * shapes, same split as lib/employees/types.ts.
 */

import { z } from "zod";
import type { Area } from "@/lib/auth/roles";
import { InventoryAccessSchema, ModuleSchema, type InventoryAccess, type Module } from "@/types/db";

export { ModuleSchema, InventoryAccessSchema };
export type { Module, InventoryAccess };

export const MODULES: readonly Module[] = ModuleSchema.options;

/**
 * (0017) The physical-inventory Areas whose WRITES are gated by the inventory
 * grant's access level (view vs edit). Cart is intentionally excluded — it's a
 * separate ordering surface/table and stays writable by any employee who can
 * see it. This is the app-side twin of migration 0017's repointed write RLS.
 */
export const INVENTORY_EDIT_AREAS: readonly Area[] = ["inventory", "shelves", "scan", "bulk_takeout", "receive"];

/**
 * Which Areas each module unlocks for an otherwise-ungranted employee.
 * `project_dashboard` is deliberately excluded from `project_management` —
 * it's owner-only always (ROLE_MATRIX hides it from employee/accountant
 * outright), never grantable to anyone.
 */
export const MODULE_AREAS: Record<Module, readonly Area[]> = {
  inventory: ["inventory", "shelves", "scan", "bulk_takeout", "receive", "cart"],
  project_management: ["projects"],
  attendance: ["attendance"],
};

/** Every Area covered by SOME module — the gated set effectiveCanSee checks against. */
export const GRANTABLE_AREAS: readonly Area[] = Object.values(MODULE_AREAS).flat();

export const ModuleGrantInputSchema = z.object({
  userId: z.uuid(),
  module: ModuleSchema,
});
export type ModuleGrantInput = z.infer<typeof ModuleGrantInputSchema>;

/** (0017) Owner sets an employee's inventory grant to view or edit. */
export const SetInventoryAccessInputSchema = z.object({
  userId: z.uuid(),
  access: InventoryAccessSchema,
});
export type SetInventoryAccessInput = z.infer<typeof SetInventoryAccessInputSchema>;

/** Result envelope shared by the mutating Server Actions (mirrors lib/employees/types.ts). */
export type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
