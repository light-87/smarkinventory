/**
 * lib/runs/types.ts — view shapes + input contracts for the Ordering
 * Workspace / Agent Run console / Order Review surfaces (plan/tab-ordering-
 * workspace.md, plan/tab-agent-run.md, plan/tab-order-review.md).
 *
 * Every mutating Server Action validates against one of the zod schemas here
 * before touching the DB (CLAUDE.md / OWNERSHIP.md convention, mirrors
 * lib/bom/types.ts).
 */

import { z } from "zod";
import { ConcurrencyPresetSchema, FeedbackTagSchema, type ConcurrencyPreset, type MpnMatch, type PartStatus } from "@/types/db";
import type { EffectiveDistributorRow } from "./distributor-sequence";

/* ────────────────────────────────────────────────────────────────────────────
 * Action inputs
 * ──────────────────────────────────────────────────────────────────────────── */

export const SaveDistributorSequenceInputSchema = z.object({
  bomId: z.uuid(),
  sequence: z.array(z.object({ distributorId: z.uuid(), enabled: z.boolean() })).min(1),
});
export type SaveDistributorSequenceInput = z.infer<typeof SaveDistributorSequenceInputSchema>;

export const SavePrioritiesInputSchema = z.object({
  bomId: z.uuid(),
  priorities: z.string().nullable(),
});
export type SavePrioritiesInput = z.infer<typeof SavePrioritiesInputSchema>;

export const ReRunItemInputSchema = z.object({
  runId: z.uuid(),
  bomLineId: z.uuid(),
});
export type ReRunItemInput = z.infer<typeof ReRunItemInputSchema>;

export const ReRunWholeOrderInputSchema = z.object({
  bomId: z.uuid(),
  tier: ConcurrencyPresetSchema.default("balanced"),
});
export type ReRunWholeOrderInput = z.infer<typeof ReRunWholeOrderInputSchema>;

export const SelectReviewOptionInputSchema = z.object({
  runId: z.uuid(),
  bomLineId: z.uuid(),
  resultId: z.uuid(),
});
export type SelectReviewOptionInput = z.infer<typeof SelectReviewOptionInputSchema>;

export const AddToCartInputSchema = z.object({
  runId: z.uuid(),
  bomLineId: z.uuid(),
  resultId: z.uuid(),
  qty: z.coerce.number().int().min(1),
});
export type AddToCartInput = z.infer<typeof AddToCartInputSchema>;

export const SubmitItemFeedbackInputSchema = z.object({
  runId: z.uuid(),
  bomLineId: z.uuid(),
  comment: z.string().trim().min(1, "Say what's wrong before sending."),
  feedbackTag: FeedbackTagSchema.nullish(),
});
export type SubmitItemFeedbackInput = z.infer<typeof SubmitItemFeedbackInputSchema>;

export const SubmitOrderRemarkInputSchema = z.object({
  runId: z.uuid(),
  comment: z.string().trim().min(1, "Write a remark before saving."),
});
export type SubmitOrderRemarkInput = z.infer<typeof SubmitOrderRemarkInputSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Ordering Workspace — read model
 * ──────────────────────────────────────────────────────────────────────────── */

export interface WorkspaceProjectHeader {
  id: string;
  name: string;
  client: string | null;
}

export interface WorkspaceBomHeader {
  id: string;
  name: string;
  buildQty: number;
  priorityNotes: string | null;
  sourcingStatus: string;
  savedRunId: string | null;
}

export interface PerLineNote {
  ref: string;
  note: string;
}

export interface MemoryContextPreviewRule {
  scope: string;
  text: string;
}

export interface MemoryContextCard {
  version: number;
  activeCount: number;
  preview: MemoryContextPreviewRule[];
  moreCount: number;
}

export interface StandardRuleRow {
  rank: number;
  key: string;
  label: string;
  mandatory: boolean;
  enabled: boolean;
}

export interface SavedRunSummary {
  id: string;
  status: string;
  isStale: boolean;
}

export interface WorkspaceData {
  project: WorkspaceProjectHeader;
  bom: WorkspaceBomHeader;
  toOrderLineCount: number;
  perLineNotes: PerLineNote[];
  distributorSequence: EffectiveDistributorRow[];
  memory: MemoryContextCard;
  standardRules: StandardRuleRow[];
  savedRun: SavedRunSummary | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Agent Run console + Review — read model
 * ──────────────────────────────────────────────────────────────────────────── */

export interface InStockLane {
  bomLineId: string;
  ref: string;
  /** BOM sheet line number (`smark_bom_lines.line_no`) — maps review back to the sheet. */
  lineNo: number | null;
  value: string;
  /** "2,568 in Box B-12" — primary location label, or a generic fallback if unresolved. */
  flag: string;
}

export interface LaneOptionRow {
  resultId: string;
  distributorId: string;
  distributorName: string;
  price: number | null;
  currency: string;
  stockQty: number | null;
  mpnMatch: MpnMatch;
  packageMatch: boolean;
  partStatus: PartStatus | null;
  orderLink: string | null;
  isRecommended: boolean;
  confidence: number | null;
  why: string;
  selected: boolean;
}

export interface SourcingLane {
  bomLineId: string;
  ref: string;
  /** BOM sheet line number (`smark_bom_lines.line_no`) — maps review back to the sheet. */
  lineNo: number | null;
  value: string;
  jobStatus: "queued" | "claimed" | "done" | "failed" | "not_dispatched";
  /** Set when Opus decided this line needs no distributor search at all (a rule hit, not a DB skip-buy). */
  aiSkipReason: string | null;
  rows: LaneOptionRow[];
}

export interface RunHeader {
  id: string;
  bomId: string;
  status: string;
  concurrencyPreset: ConcurrencyPreset;
  estCost: number | null;
  actualCost: number | null;
  createdAt: string;
  narration: string | null;
  isStale: boolean;
}

export interface RunConsoleData {
  project: WorkspaceProjectHeader;
  bom: WorkspaceBomHeader;
  run: RunHeader;
  inStockLanes: InStockLane[];
  sourcingLanes: SourcingLane[];
  doneCount: number;
  totalCount: number;
}

export interface ReviewFeedbackEntry {
  id: string;
  bomLineId: string | null;
  comment: string;
  createdAt: string;
}

export interface ReviewLineCard extends SourcingLane {
  cartQtyNeeded: number;
  inCartQty: number | null;
  feedback: ReviewFeedbackEntry[];
}

export interface ReviewData {
  project: WorkspaceProjectHeader;
  bom: WorkspaceBomHeader;
  run: RunHeader;
  inStockLanes: InStockLane[];
  lines: ReviewLineCard[];
  orderRemarks: ReviewFeedbackEntry[];
  cartAddedCount: number;
}

/** SSE snapshot payload shape (app/api/runs/[runId]/stream) — see hooks/use-run-stream.ts. */
export interface RunStreamSnapshot {
  status: string;
  narration: string | null;
  doneCount: number;
  totalCount: number;
  estCost: number | null;
  actualCost: number | null;
  sourcingLanes: SourcingLane[];
}
