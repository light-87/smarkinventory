/**
 * lib/bom/validate.ts — required-field validation for the Create-BOM grid
 * (R2-19: "required-field validation (Reference/Qty/Value at minimum)").
 * Pure — shared by the client grid (inline feedback) and the server action
 * (the real gate; never trust the client alone).
 */

import type { BomTemplateColumn } from "@/types/db";
import type { CreateBomRowInput } from "./types";

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** Every "Row N: <Label> is required." violation across the grid — empty array means the grid is valid. */
export function validateBomRows(columns: readonly BomTemplateColumn[], rows: readonly CreateBomRowInput[]): string[] {
  if (rows.length === 0) return ["Add at least one line."];

  const requiredColumns = columns.filter((column) => column.required);
  const errors: string[] = [];

  rows.forEach((row, index) => {
    for (const column of requiredColumns) {
      if (isBlank(row[column.key])) errors.push(`Row ${index + 1}: ${column.label} is required.`);
    }
  });

  return errors;
}
