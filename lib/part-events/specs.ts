/**
 * lib/part-events/specs.ts — builds the part-detail "Specifications" grid
 * (tab-part-detail.md §2: "value, package, dielectric/tolerance/voltage etc.
 * from attributes"; R2-11: "+ Last price, Stock value"). Pure.
 */

import { formatINR } from "@/lib/format";
import type { PartRow } from "@/types/db";
import type { SpecEntry } from "./types";

const KNOWN_ATTRIBUTE_LABELS: Record<string, string> = {
  dielectric: "Dielectric",
  tolerance: "Tolerance",
  wattage: "Wattage",
  current: "Current",
  pin_count: "Pin count",
  esr: "ESR",
  inductance: "Inductance",
};

function attributeLabel(key: string): string {
  return KNOWN_ATTRIBUTE_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** qty × last_unit_price — null when the part has never been priced (R2-11 honesty rule). */
export function computeStockValue(part: PartRow): number | null {
  if (part.last_unit_price == null) return null;
  return Math.round(part.total_qty * part.last_unit_price * 100) / 100;
}

export function buildPartSpecs(part: PartRow): SpecEntry[] {
  const specs: SpecEntry[] = [];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined) return;
    const str = String(value).trim();
    if (!str) return;
    specs.push({ label, value: str });
  };

  push("Value", part.value);
  push("Voltage", part.voltage);
  push("Package", part.package);
  push("Category", part.category);
  push("Manufacturer", part.manufacturer);
  push("LCSC PN", part.lcsc_pn);

  for (const [key, value] of Object.entries(part.attributes)) {
    push(attributeLabel(key), value);
  }

  push("Last price", part.last_unit_price != null ? formatINR(part.last_unit_price) : "Not yet priced");
  const stockValue = computeStockValue(part);
  push("Stock value", stockValue != null ? formatINR(stockValue) : "— (unpriced)");

  return specs;
}
