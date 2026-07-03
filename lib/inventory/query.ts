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
 */

import { createClient } from "@/lib/supabase/server";
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

  const [partsRes, locationsRes, boxesRes, shelvesRes, eventsRes, projectsRes] = await Promise.all([
    supabase.from(TABLES.parts).select("*").order("internal_pid", { ascending: true }),
    supabase.from(TABLES.stock_locations).select("*"),
    supabase.from(TABLES.big_boxes).select("*"),
    supabase.from(TABLES.shelves).select("*"),
    // Distributor/Project facets derive from order history (mission: "Distributor
    // facet ← the part's order history", "Project facet ← projects a part was
    // used in") — only these event types carry that context.
    supabase.from(TABLES.part_events).select("*").in("event_type", ["ordered", "received", "picked"]),
    supabase.from(TABLES.projects).select("*"),
  ]);

  const firstError =
    partsRes.error ?? locationsRes.error ?? boxesRes.error ?? shelvesRes.error ?? eventsRes.error ?? projectsRes.error;
  if (firstError) return { ok: false, error: firstError.message };

  let parsed;
  try {
    parsed = {
      parts: PartRowSchema.array().parse(partsRes.data ?? []),
      locations: StockLocationRowSchema.array().parse(locationsRes.data ?? []),
      boxes: BigBoxRowSchema.array().parse(boxesRes.data ?? []),
      shelves: ShelfRowSchema.array().parse(shelvesRes.data ?? []),
      events: PartEventRowSchema.array().parse(eventsRes.data ?? []),
      projects: ProjectRowSchema.array().parse(projectsRes.data ?? []),
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
