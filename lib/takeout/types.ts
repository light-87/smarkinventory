/**
 * lib/takeout/types.ts — shared shapes + input contracts for Bulk takeout
 * (plan/tab-bulk-pick.md · FEATURES.md §5.6).
 *
 * Every server action validates its payload against one of the zod schemas
 * below before touching the DB (CLAUDE.md / OWNERSHIP.md convention) — the
 * `Database` generic on the Supabase client is not the validation layer.
 */

import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Raw lines — the shared shape produced by lib/takeout/parse.ts (upload/paste)
 * or read straight off `smark_bom_lines` (project BOM pick), before matching.
 * ──────────────────────────────────────────────────────────────────────────── */

export const RawTakeoutLineSchema = z.object({
  lineNo: z.number().int().nullable(),
  /** Raw reference designators, e.g. `"C3,C69,C70"`. */
  references: z.string().nullable(),
  qty: z.number().nullable(),
  value: z.string().nullable(),
  /** Raw footprint string — BOM lines never carry a clean `package` column. */
  footprint: z.string().nullable(),
  dnp: z.boolean(),
  description: z.string().nullable(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  lcscPn: z.string().nullable(),
});
export type TakeoutRawLine = z.infer<typeof RawTakeoutLineSchema>;

export type TakeoutMatchState = "in_stock" | "to_order";

/** The resolved physical home a line will be picked from (one per line — the biggest-qty home when a part has more than one). */
export interface TakeoutLocationLabel {
  locationId: string;
  bigBoxId: string;
  partId: string;
  qty: number;
  /** "Shelf B · Capacitors 0603" — same convention as Inventory/Part-detail's location chip. */
  label: string;
}

/** One BOM/paste/upload line after matcher resolution — what the table renders. */
export interface ResolvedTakeoutLine {
  /** Stable React key. */
  key: string;
  lineNo: number | null;
  references: string | null;
  /** The BOM's own per-unit qty (pre-multiplier). */
  rawQty: number;
  /** `rawQty × multiplier` [R2-27] — recomputed client-side whenever the ×N banner changes. */
  pickQty: number;
  value: string | null;
  matchState: TakeoutMatchState;
  matchedPartId: string | null;
  matchedInternalPid: string | null;
  location: TakeoutLocationLabel | null;
}

export type TakeoutSourceKind = "upload" | "paste" | "project_bom";

/** What a "load"/"resolve" call hands back to the screen. */
export interface LoadedTakeoutSession {
  sourceKind: TakeoutSourceKind;
  /** Filename, "pasted BOM", or "<project> · <bom name>". */
  sourceLabel: string;
  bomId: string | null;
  /** Prefill for the ×N banner — the BOM's `build_qty`, or 1 for ad-hoc sources. */
  defaultMultiplier: number;
  lines: ResolvedTakeoutLine[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Server action input contracts
 * ──────────────────────────────────────────────────────────────────────────── */

export const LoadProjectBomInputSchema = z.object({ bomId: z.uuid() });
export type LoadProjectBomInput = z.infer<typeof LoadProjectBomInputSchema>;

export const ResolveAdHocInputSchema = z.object({
  lines: z.array(RawTakeoutLineSchema).min(1, "No BOM lines were found in that upload/paste."),
  /** Ad-hoc uploads/pastes get an OPTIONAL ×N — default 1 (no multiplier). */
  multiplier: z.coerce.number().int().positive().max(1000).default(1),
  sourceKind: z.enum(["upload", "paste"]),
  sourceLabel: z.string().trim().min(1).default("Ad-hoc BOM"),
});
export type ResolveAdHocInput = z.infer<typeof ResolveAdHocInputSchema>;

export const FinishTakeoutLineInputSchema = z.object({
  partId: z.uuid(),
  locationId: z.uuid(),
  bigBoxId: z.uuid(),
  pickQty: z.number().int().positive(),
  reference: z.string().nullable(),
});
export type FinishTakeoutLineInput = z.infer<typeof FinishTakeoutLineInputSchema>;

export const FinishTakeoutInputSchema = z.object({
  /** Links movements to the BOM for project attribution (R2-03 ripple) — null for ad-hoc sources. */
  bomId: z.uuid().nullable(),
  lines: z.array(FinishTakeoutLineInputSchema).min(1, "Check at least one line before finishing."),
});
export type FinishTakeoutInput = z.infer<typeof FinishTakeoutInputSchema>;
