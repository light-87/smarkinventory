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
import { ModuleSchema, type Module } from "@/types/db";

export { ModuleSchema };
export type { Module };

export const MODULES: readonly Module[] = ModuleSchema.options;

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

/** Result envelope shared by the mutating Server Actions (mirrors lib/employees/types.ts). */
export type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
