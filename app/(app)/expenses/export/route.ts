import { NextResponse } from "next/server";
// Namespace import, not `import XLSX from "xlsx"`: xlsx's ESM build
// (node_modules/xlsx/xlsx.mjs) has no default export, only named ones
// (`utils`, `write`, `read`, ...) — a default import happens to work under
// `next dev`'s webpack/CJS-interop but fails `next build`'s stricter
// Turbopack ESM resolution ("Export default doesn't exist in target
// module"). Several already-shipped files (lib/import/bom.ts,
// lib/import/stocklist.ts, lib/bom/xlsx-template.ts, lib/bom/parse-upload.ts
// — none owned by this package) use the default-import form and hit the
// same build error; flagged in this package's report for the integrator
// rather than edited here.
import * as XLSX from "xlsx";
import { getSessionUser } from "@/lib/auth/session";
import { canSee } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { decodeEntryFiltersFromSearchParams, filterEntries } from "@/lib/expenses/filter";
import { EXPENSE_EXPORT_HEADERS, entryToExportRow, toCsv } from "@/lib/expenses/csv";
import { getEntries } from "@/lib/expenses/queries";

/**
 * GET /expenses/export?...&format=csv|xlsx — R2-33: "entry list exports
 * CSV/xlsx per filter (accountants live in Excel)". Filters are read from
 * the query string (lib/expenses/filter.ts encode/decode) so the download
 * always matches exactly what the on-screen table shows.
 *
 * Independently role-guarded (not just the page's `notFound()`): an
 * employee hitting this URL directly must get the same 404 as the page,
 * not a data leak through a route the nav simply doesn't link to.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canSee(user.role, "expenses")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const entries = await getEntries(supabase);

  const { searchParams } = new URL(request.url);
  const filters = decodeEntryFiltersFromSearchParams(searchParams);
  const filtered = filterEntries(entries, filters);
  const rows = filtered.map(entryToExportRow);

  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    const sheet = XLSX.utils.aoa_to_sheet([[...EXPENSE_EXPORT_HEADERS], ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Entries");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="smarkstock-expenses-${stamp}.xlsx"`,
      },
    });
  }

  const csv = toCsv([[...EXPENSE_EXPORT_HEADERS], ...rows]);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smarkstock-expenses-${stamp}.csv"`,
    },
  });
}
