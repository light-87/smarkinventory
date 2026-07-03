/**
 * lib/part-events/contested.ts — the R2-10 contested-stock strip:
 * "demanded 600 across 2 projects · 500 available · 100 in cart →". Pure —
 * takes an already-fetched `v_part_demand` row + open-cart qty.
 */

import { formatNumber } from "@/lib/format";
import type { PartDemandRow } from "@/types/db";
import type { ContestedStock } from "./types";

export function buildContestedStock(demand: PartDemandRow, inCartQty: number): ContestedStock {
  const projectIds = new Set(demand.breakdown.map((slice) => slice.project_id));
  return {
    partId: demand.part_id,
    demand: demand.demand,
    available: demand.available,
    shortfall: demand.shortfall,
    projectCount: projectIds.size,
    inCartQty,
  };
}

export function buildContestedMessage(contested: ContestedStock): string {
  const projectWord = contested.projectCount === 1 ? "project" : "projects";
  const parts = [
    `Demanded ${formatNumber(contested.demand)} across ${contested.projectCount} ${projectWord}`,
    `${formatNumber(contested.available)} available`,
  ];
  if (contested.inCartQty > 0) parts.push(`${formatNumber(contested.inCartQty)} in cart`);
  return parts.join(" · ");
}
