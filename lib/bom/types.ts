/**
 * lib/bom/types.ts — input contracts for the BOM-pipeline surface
 * (plan/tab-orders-projects.md §2/§5 R2-03/R2-19).
 *
 * Every server action validates its payload against one of these zod schemas
 * before touching the DB (CLAUDE.md / OWNERSHIP.md convention, mirrors
 * lib/receive/types.ts) — the `Database` generic on the Supabase client is
 * not the validation layer.
 */

import { z } from "zod";
import { BomTemplateColumnSchema, FieldTypeSchema } from "@/types/db";

/** "Upload BOM" — name + the already-read file bytes (Server Actions accept `File`/`FormData` directly). */
export const UploadBomInputSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "Name this BOM"),
  priorityNotes: z.string().trim().nullish(),
});
export type UploadBomInput = z.infer<typeof UploadBomInputSchema>;

/** One grid row from the Create-BOM editor — values keyed by column `key` (standard or custom). */
const BomRowValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const CreateBomRowInputSchema = z.record(z.string(), BomRowValueSchema);
export type CreateBomRowInput = z.infer<typeof CreateBomRowInputSchema>;

/** "Create BOM in-app" [R2-19] — columns (standard + any "+ Add field" custom ones) + the grid rows. */
export const CreateBomInAppInputSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "Name this BOM"),
  buildQty: z.coerce.number().int().min(1).default(1),
  priorityNotes: z.string().trim().nullish(),
  columns: z.array(BomTemplateColumnSchema).min(1),
  rows: z.array(CreateBomRowInputSchema),
});
export type CreateBomInAppInput = z.infer<typeof CreateBomInAppInputSchema>;

/** Build-qty editor (×N banner) — R2-27. */
export const UpdateBuildQtyInputSchema = z.object({
  bomId: z.uuid(),
  buildQty: z.coerce.number().int().min(1, "Build qty must be at least 1"),
});
export type UpdateBuildQtyInput = z.infer<typeof UpdateBuildQtyInputSchema>;

/** "+ Add field" on the Create-BOM grid. */
export const AddCustomColumnInputSchema = z.object({
  label: z.string().trim().min(1, "Name the field"),
  type: FieldTypeSchema,
});
export type AddCustomColumnInput = z.infer<typeof AddCustomColumnInputSchema>;

export const ReconcileBomInputSchema = z.object({ bomId: z.uuid() });
export type ReconcileBomInput = z.infer<typeof ReconcileBomInputSchema>;
