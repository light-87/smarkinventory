"use server";

/**
 * lib/takeout/actions.ts — Server Actions for Bulk takeout
 * (plan/tab-bulk-pick.md · FEATURES.md §5.6).
 *
 * Thin wrappers: validate with zod (lib/takeout/types.ts), resolve the
 * caller's session + role via the per-request RLS-bound client
 * (lib/supabase/server.ts — never the service key, per CLAUDE.md), then
 * delegate to lib/takeout/queries.ts (reads) and lib/takeout/resolve.ts
 * (pure matching/pick-math). Finish writes go through `lib/movements`
 * (scan's movement/undo write path — cross-package import allowance in
 * docs/OWNERSHIP.md: "lib/movements (scan) ← takeout/receive").
 *
 * Known gap (verified finding #2, notes-for-integrator — NOT fixed here):
 * `finishTakeoutAction` intentionally does not touch `smark_bom_lines` or
 * `v_part_demand` (0005_views_fks.sql) — a matched, non-DNP line keeps
 * contributing `qty × build_qty` to that view's demand/shortfall forever,
 * even after this action bulk-picks its parts out of stock. Because a pick
 * DECREASES `total_qty` (the view's `available`), a BOM that reconciled
 * fully in-stock can flip to a false positive shortfall the moment it's
 * picked, and lib/orders/demand.ts's auto-shortfall reconciler then queues a
 * re-order for parts that were just consumed as intended (FEATURES §20.1
 * risk #1: "demand double-ordering"). Fixing it needs either a per-line
 * fulfilled/picked marker on `smark_bom_lines` or netting `v_part_demand`
 * against `bulk_pick` movements per `bom_id` — both are `v_part_demand`/
 * schema changes, and migrations 0001–0005 are frozen for every feature
 * package (docs/OWNERSHIP.md); flagged for the integrator rather than
 * worked around here with an unreviewed view-shadowing query.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canSee, canWrite, type Role } from "@/lib/auth/roles";
import { recordMovement, undoMovement } from "@/lib/movements";
import { getBomForTakeout, getPickableProjects, getTakeoutCatalog, getTakeoutLocations, type PickableProject } from "./queries";
import { buildResolvedLines, matchAgainstCatalog } from "./resolve";
import {
  FinishTakeoutInputSchema,
  LoadProjectBomInputSchema,
  ResolveAdHocInputSchema,
  type FinishTakeoutInput,
  type LoadedTakeoutSession,
  type ResolveAdHocInput,
} from "./types";

async function requireTakeoutReader(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; actorId: string; role: Role }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canSee(role, "bulk_takeout")) {
    throw new Error("You don't have access to Bulk takeout.");
  }
  return { supabase, actorId: user.id, role };
}

async function requireTakeoutWriter() {
  const { supabase, actorId, role } = await requireTakeoutReader();
  if (!canWrite(role, "bulk_takeout")) {
    throw new Error("You don't have permission to take out stock.");
  }
  return { supabase, actorId };
}

/* ────────────────────────────────────────────────────────────────────────────
 * "Pick a project BOM" picker
 * ──────────────────────────────────────────────────────────────────────────── */

export async function listPickableProjectsAction(): Promise<PickableProject[]> {
  const { supabase } = await requireTakeoutReader();
  return getPickableProjects(supabase);
}

export async function loadProjectBomAction(bomId: string): Promise<LoadedTakeoutSession> {
  const { bomId: parsedBomId } = LoadProjectBomInputSchema.parse({ bomId });
  const { supabase } = await requireTakeoutReader();

  const loaded = await getBomForTakeout(supabase, parsedBomId);
  if (!loaded) throw new Error("That BOM could not be found — it may have been deleted or renamed.");

  const catalog = await getTakeoutCatalog(supabase);
  const matched = matchAgainstCatalog(loaded.rawLines, catalog);
  const partIds = Array.from(new Set(matched.map((m) => m.hit?.part.id).filter((id): id is string => Boolean(id))));
  const locationsByPartId = await getTakeoutLocations(supabase, partIds);
  const lines = buildResolvedLines(matched, loaded.bom.buildQty, locationsByPartId);

  return {
    sourceKind: "project_bom",
    sourceLabel: `${loaded.projectName} · ${loaded.bom.name}`,
    bomId: loaded.bom.id,
    defaultMultiplier: loaded.bom.buildQty,
    lines,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ad-hoc upload / paste
 * ──────────────────────────────────────────────────────────────────────────── */

export async function resolveAdHocLinesAction(input: ResolveAdHocInput): Promise<LoadedTakeoutSession> {
  const parsed = ResolveAdHocInputSchema.parse(input);
  const { supabase } = await requireTakeoutReader();

  const catalog = await getTakeoutCatalog(supabase);
  const matched = matchAgainstCatalog(parsed.lines, catalog);
  const partIds = Array.from(new Set(matched.map((m) => m.hit?.part.id).filter((id): id is string => Boolean(id))));
  const locationsByPartId = await getTakeoutLocations(supabase, partIds);
  const lines = buildResolvedLines(matched, parsed.multiplier, locationsByPartId);

  return {
    sourceKind: parsed.sourceKind,
    sourceLabel: parsed.sourceLabel,
    bomId: null,
    defaultMultiplier: parsed.multiplier,
    lines,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Finish — one confirm → a `bulk_pick` movement per checked line
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FinishTakeoutLineFailure {
  reference: string | null;
  error: string;
}

/** One checked line that logged successfully — `movementId` is what makes the whole batch undoable (finding #8). */
export interface FinishTakeoutLineSuccess {
  reference: string | null;
  movementId: string;
}

export interface FinishTakeoutResult {
  succeeded: FinishTakeoutLineSuccess[];
  failed: FinishTakeoutLineFailure[];
}

/**
 * Writes one `smark_movements` row (reason `bulk_pick`, `bom_id` linked when
 * picking from a project BOM) per checked line, via `lib/movements.recordMovement`
 * — the SAME write path Scan's take-out and Receive's confirm use, so these
 * movements are individually undoable (`undo_of`) and surface in Part
 * detail's history the same way (FEATURES.md §9).
 *
 * Sequential, not `Promise.all` — `recordMovement` does an optimistic
 * read-modify-write per location, and it's not unusual for two lines in the
 * same BOM to resolve to the same part/location (two reference groups of the
 * same value); doing this one at a time avoids needless concurrent-retry
 * churn and keeps movement ordering deterministic. Partial failure is
 * reported per line rather than aborting the whole batch — a line that fails
 * (e.g. someone else already took the last of that part) shouldn't block the
 * other checked lines from logging.
 *
 * Returns each succeeded line's movement id (finding #8: this was previously
 * just a count, which made the "every stock mutation is undoable" hard rule
 * impossible to honor here — the client had no ids to undo. The Finish toast
 * now offers one Undo pill for the whole batch via `undoBulkTakeoutAction`,
 * mirroring receive/top-up-form.tsx.)
 */
export async function finishTakeoutAction(input: FinishTakeoutInput): Promise<FinishTakeoutResult> {
  const parsed = FinishTakeoutInputSchema.parse(input);
  const { supabase, actorId } = await requireTakeoutWriter();

  const succeeded: FinishTakeoutLineSuccess[] = [];
  const failed: FinishTakeoutLineFailure[] = [];

  for (const line of parsed.lines) {
    try {
      const { movement } = await recordMovement(supabase, {
        locationId: line.locationId,
        partId: line.partId,
        bigBoxId: line.bigBoxId,
        deltaQty: -line.pickQty,
        reason: "bulk_pick",
        bomId: parsed.bomId,
        actor: actorId,
      });
      succeeded.push({ reference: line.reference, movementId: movement.id });
    } catch (error) {
      failed.push({
        reference: line.reference,
        error: error instanceof Error ? error.message : "Could not log this movement.",
      });
    }
  }

  if (succeeded.length > 0) {
    revalidatePath("/bulk-takeout");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
  }

  return { succeeded, failed };
}

export interface UndoBulkTakeoutResult {
  succeeded: number;
  failed: { movementId: string; error: string }[];
}

/**
 * Reverses every movement from one Finish batch (finding #8) — the Undo pill
 * on the bulk-takeout toast, same pattern as
 * lib/receive/actions.ts's `undoReceiveMovementAction`. One movement failing
 * to undo (e.g. already undone by someone else) doesn't block the others.
 */
export async function undoBulkTakeoutAction(movementIds: readonly string[]): Promise<UndoBulkTakeoutResult> {
  const { supabase, actorId } = await requireTakeoutWriter();

  let succeeded = 0;
  const failed: { movementId: string; error: string }[] = [];

  for (const movementId of movementIds) {
    try {
      await undoMovement(supabase, movementId, actorId);
      succeeded += 1;
    } catch (error) {
      failed.push({ movementId, error: error instanceof Error ? error.message : "Could not undo this movement." });
    }
  }

  if (succeeded > 0) {
    revalidatePath("/bulk-takeout");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
  }

  return { succeeded, failed };
}
