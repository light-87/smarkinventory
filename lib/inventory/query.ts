/**
 * lib/inventory/query.ts — server-side data loader for the Inventory surface.
 *
 * Loads the full catalog + the facet-source tables and joins them in
 * application code. `types/db.ts`'s `Database` generic deliberately doesn't
 * model foreign-key relationships (`Relationships: []` on every table — see
 * that file's header), so embedded PostgREST selects (`select("*, fk(...)")`)
 * wouldn't type-check meaningfully here; plain per-table queries + in-memory
 * maps keep everything strongly typed against the zod row schemas instead.
 *
 * Scale note: FEATURES.md §14 sizes the catalog at ~2000 parts. Loading the
 * whole thing server-side and filtering/faceting client-side
 * (lib/inventory/filter.ts) is the simplest CORRECT approach at that size. If
 * the catalog or `smark_part_events` history grows much larger, swap this for
 * server-side pagination + a facet-count view — flagged for the integrator,
 * not solved here.
 *
 * Every read below pages via `selectAllRows` because "the whole thing" is more
 * rows than PostgREST will hand over at once: the real stock list is ~2000
 * parts against a 1000-row `max_rows` cap, and PostgREST truncates SILENTLY.
 * Plain `.select("*")` here showed exactly half the catalog — with correct-
 * looking counts — until 2026-08-10. Each paged query needs its stable
 * `.order()`; see lib/supabase/select-all.ts.
 */

import { createClient } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/select-all";
import {
  BigBoxRowSchema,
  PartEventRowSchema,
  PartRowSchema,
  ProjectRowSchema,
  ShelfRowSchema,
  StockLocationRowSchema,
  TABLES,
} from "@/types/db";
import { stockStateOf } from "./stock-state";
import type { InventoryPart, InventoryPartLocation } from "./types";

export type InventoryListResult = { ok: true; parts: InventoryPart[] } | { ok: false; error: string };

export async function getInventoryList(): Promise<InventoryListResult> {
  const supabase = await createClient();

  let raw;
  try {
    const [parts, locations, boxes, shelves, events, projects] = await Promise.all([
      selectAllRows((from, to) =>
        supabase.from(TABLES.parts).select("*").order("internal_pid", { ascending: true }).range(from, to),
      ),
      selectAllRows((from, to) => supabase.from(TABLES.stock_locations).select("*").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from(TABLES.big_boxes).select("*").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from(TABLES.shelves).select("*").order("id").range(from, to)),
      // Distributor/Project facets derive from order history (mission: "Distributor
      // facet ← the part's order history", "Project facet ← projects a part was
      // used in") — only these event types carry that context.
      selectAllRows((from, to) =>
        supabase
          .from(TABLES.part_events)
          .select("*")
          .in("event_type", ["ordered", "received", "picked"])
          .order("id")
          .range(from, to),
      ),
      selectAllRows((from, to) => supabase.from(TABLES.projects).select("*").order("id").range(from, to)),
    ]);
    raw = { parts, locations, boxes, shelves, events, projects };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load inventory." };
  }

  let parsed;
  try {
    parsed = {
      parts: PartRowSchema.array().parse(raw.parts),
      locations: StockLocationRowSchema.array().parse(raw.locations),
      boxes: BigBoxRowSchema.array().parse(raw.boxes),
      shelves: ShelfRowSchema.array().parse(raw.shelves),
      events: PartEventRowSchema.array().parse(raw.events),
      projects: ProjectRowSchema.array().parse(raw.projects),
    };
  } catch {
    return { ok: false, error: "Inventory data did not match the expected shape." };
  }

  const boxById = new Map(parsed.boxes.map((b) => [b.id, b]));
  const shelfById = new Map(parsed.shelves.map((s) => [s.id, s]));
  const projectById = new Map(parsed.projects.map((p) => [p.id, p]));

  const locationsByPart = new Map<string, InventoryPartLocation[]>();
  for (const loc of parsed.locations) {
    const box = boxById.get(loc.big_box_id);
    const shelf = box ? shelfById.get(box.shelf_id) : undefined;
    const list = locationsByPart.get(loc.part_id) ?? [];
    list.push({
      id: loc.id,
      qty: loc.qty,
      boxName: box?.name ?? "—",
      shelfCode: shelf?.code ?? "—",
      lastCountedAt: loc.last_counted_at,
    });
    locationsByPart.set(loc.part_id, list);
  }

  const distributorsByPart = new Map<string, Set<string>>();
  const projectNamesByPart = new Map<string, Set<string>>();
  for (const event of parsed.events) {
    if (event.distributor) {
      const set = distributorsByPart.get(event.part_id) ?? new Set<string>();
      set.add(event.distributor);
      distributorsByPart.set(event.part_id, set);
    }
    if (event.project_id) {
      const project = projectById.get(event.project_id);
      if (project) {
        const set = projectNamesByPart.get(event.part_id) ?? new Set<string>();
        set.add(project.name);
        projectNamesByPart.set(event.part_id, set);
      }
    }
  }

  const inventoryParts: InventoryPart[] = parsed.parts.map((part) => ({
    ...part,
    locations: locationsByPart.get(part.id) ?? [],
    stockState: stockStateOf(part.total_qty, part.reorder_point),
    distributorNames: Array.from(distributorsByPart.get(part.id) ?? []).sort(),
    projectNames: Array.from(projectNamesByPart.get(part.id) ?? []).sort(),
  }));

  return { ok: true, parts: inventoryParts };
}
