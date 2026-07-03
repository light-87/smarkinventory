/**
 * lib/bom/xlsx-template.ts — the downloadable BOM template workbook (R2-19).
 *
 * Renders the SAME columns Create-BOM starts from: the standard 11 plus any
 * company custom columns remembered on `smark_bom_templates` — "one
 * structure everywhere" (plan/tab-orders-projects.md R2-19). One header row,
 * no sample data (an empty, ready-to-fill sheet, matching the baseline
 * prototype's "Download template ↓").
 */

// Namespace import — see the note in lib/bom/parse-upload.ts: the default
// form breaks Next's Turbopack production build against this xlsx build.
import * as XLSX from "xlsx";
import type { BomTemplateColumn } from "@/types/db";

const SHEET_NAME = "BOM";

/** Builds the template workbook as a Buffer, ready for a Route Handler's `Content-Disposition` response. */
export function buildBomTemplateWorkbook(columns: readonly BomTemplateColumn[]): Buffer {
  const header = columns.map((column) => column.label);
  const sheet = XLSX.utils.aoa_to_sheet([header]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
