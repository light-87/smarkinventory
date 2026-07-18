/**
 * lib/rbac/access.ts — the additive gating layer on top of lib/auth/roles'
 * canSee/accessFor (migration 0013). This module never REPLACES canSee — it
 * wraps it: `effectiveCanSee` is exactly `canSee` for owner and accountant
 * (this system predates RBAC and must not regress their access), and for
 * `employee` it ALSO requires the bundling module to be granted, but ONLY
 * for Areas that are actually part of some module (`GRANTABLE_AREAS`).
 * Ungated areas (dashboard, daily_reports, settings, users, profile,
 * ai_memory, project_dashboard — none of which appear in MODULE_AREAS) pass
 * straight through canSee for every role, employee included.
 */

import { AREAS, canSee, canWrite, type Area, type Role } from "@/lib/auth/roles";
import { GRANTABLE_AREAS, INVENTORY_EDIT_AREAS, MODULE_AREAS, MODULES, type InventoryAccess, type Module } from "./types";

/** True if this Area is bundled into some module (i.e. is subject to per-employee grants at all). */
export function isGrantableArea(area: Area): boolean {
  return (GRANTABLE_AREAS as readonly Area[]).includes(area);
}

/**
 * The additive gate. `role` must ALREADY pass `canSee` (the existing
 * ROLE_MATRIX check) — grants only ever narrow, never widen, access.
 */
export function effectiveCanSee(role: Role, area: Area, grantedModules: readonly Module[]): boolean {
  if (!canSee(role, area)) return false;
  if (role !== "employee") return true;
  if (!isGrantableArea(area)) return true;
  return MODULES.some((module) => grantedModules.includes(module) && MODULE_AREAS[module].includes(area));
}

/** Every Area this role effectively sees, in AREAS order — the gated twin of `visibleAreas()`. */
export function effectiveAreasForUser(role: Role, grantedModules: readonly Module[]): Area[] {
  return AREAS.filter((area) => effectiveCanSee(role, area, grantedModules));
}

/**
 * (0017) The write twin of effectiveCanSee, additive over `canWrite`. Identical
 * to `canWrite` for owner/accountant and for any non-inventory area; for an
 * `employee` on an INVENTORY_EDIT_AREA it additionally requires the inventory
 * grant to be `access = 'edit'` (a view-only employee is denied write). The DB
 * twin is migration 0017's `smark_can_edit_inventory()` on the write RLS — this
 * only hides buttons / gives a friendly error; RLS is the real boundary.
 */
export function effectiveCanWrite(
  role: Role,
  area: Area,
  opts: { inventoryAccess: InventoryAccess | null },
): boolean {
  if (!canWrite(role, area)) return false;
  if (role !== "employee") return true;
  if (!(INVENTORY_EDIT_AREAS as readonly Area[]).includes(area)) return true;
  return opts.inventoryAccess === "edit";
}
