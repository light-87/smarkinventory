import { NextResponse } from "next/server";
import { INVENTORY_EXPORT_HEADERS, inventoryPartToCsvRow, toCsv } from "@/lib/inventory/csv";
import { decodeFiltersFromSearchParams, filterInventoryParts } from "@/lib/inventory/filter";
import { getInventoryList } from "@/lib/inventory/query";

/**
 * GET /inventory/export?q=...&f_Category=...&f_Stock=... — R2-33: "Export
 * button: current filtered view → CSV". Filters are read from the query
 * string (lib/inventory/filter.ts encode/decode) so the download always
 * matches exactly what the Export button's href encodes on screen.
 */
export async function GET(request: Request) {
  const result = await getInventoryList();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const { search, filters } = decodeFiltersFromSearchParams(searchParams);
  const filtered = filterInventoryParts(result.parts, search, filters);
  const csv = toCsv([INVENTORY_EXPORT_HEADERS, ...filtered.map(inventoryPartToCsvRow)]);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smarkstock-inventory-${stamp}.csv"`,
    },
  });
}
