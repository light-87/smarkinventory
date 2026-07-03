"use server";

/**
 * app/(app)/projects/[projectId]/runs/[runId]/actions.ts — Server Actions for
 * the Agent Run console + Order Review (plan/tab-agent-run.md,
 * plan/tab-order-review.md). Thin wrappers: resolve the caller's session +
 * role (owner/employee full, accountant read-only — FEATURES.md §2
 * "Projects" row), then delegate to lib/runs/**. Mirrors
 * app/(app)/projects/[projectId]/ordering/[bomId]/actions.ts's shape.
 */

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { reRunItem, reRunWholeOrder } from "@/lib/runs/enqueue";
import { selectReviewOption } from "@/lib/runs/select";
import { addReviewLineToCart } from "@/lib/runs/cart";
import { submitItemFeedback, submitOrderRemark } from "@/lib/runs/feedback";
import {
  AddToCartInputSchema,
  ReRunItemInputSchema,
  ReRunWholeOrderInputSchema,
  SelectReviewOptionInputSchema,
  SubmitItemFeedbackInputSchema,
  SubmitOrderRemarkInputSchema,
  type AddToCartInput,
  type ReRunItemInput,
  type ReRunWholeOrderInput,
  type SelectReviewOptionInput,
  type SubmitItemFeedbackInput,
  type SubmitOrderRemarkInput,
} from "@/lib/runs/types";

async function requireProjectsWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "projects")) {
    throw new Error("You don't have permission to make changes on Projects.");
  }
  return { supabase, actorId: user.id };
}

export type RunActionResult = { ok: true } | { ok: false; error: string };
export type RunOrJobActionResult = { ok: true; runId: string } | { ok: false; error: string };

/** "↺ Re-run this item" — queues one fresh job on the existing run, reusing its already-planned distributor order for the line. */
export async function reRunItemAction(input: ReRunItemInput): Promise<RunOrJobActionResult> {
  const parsed = ReRunItemInputSchema.parse(input);
  const { supabase } = await requireProjectsWriter();
  const service = createServiceClient();
  const result = await reRunItem(supabase, service, parsed);
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}

/** "↺ Re-run whole order" — a fresh run for the same BOM. */
export async function reRunWholeOrderAction(input: ReRunWholeOrderInput): Promise<RunOrJobActionResult> {
  const parsed = ReRunWholeOrderInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();
  const service = createServiceClient();
  const result = await reRunWholeOrder(supabase, service, { bomId: parsed.bomId, tier: parsed.tier, actorId });
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}

/** Review's radio-select — confirm/override the recommended option. */
export async function selectReviewOptionAction(input: SelectReviewOptionInput): Promise<RunActionResult> {
  const parsed = SelectReviewOptionInputSchema.parse(input);
  const { actorId } = await requireProjectsWriter();
  const service = createServiceClient();
  const result = await selectReviewOption(service, { ...parsed, actorId });
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}

export type AddToCartActionResult = { ok: true; cartItemId: string; alreadyInCart: boolean } | { ok: false; error: string };

/** Review's ONLY order action (R2-08) — add the selected option + needed qty to the smart cart. */
export async function addToCartAction(input: AddToCartInput): Promise<AddToCartActionResult> {
  const parsed = AddToCartInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();
  const service = createServiceClient();
  const result = await addReviewLineToCart(supabase, service, { ...parsed, actorId });
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}

export type FeedbackActionResult = { ok: true; ruleId: string } | { ok: false; error: string };

/** Per-item feedback (💬 toggle) → suggested rule, scope Part. */
export async function submitItemFeedbackAction(input: SubmitItemFeedbackInput): Promise<FeedbackActionResult> {
  const parsed = SubmitItemFeedbackInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();
  const service = createServiceClient();
  const result = await submitItemFeedback(supabase, service, { runId: parsed.runId, bomLineId: parsed.bomLineId, comment: parsed.comment, actorId });
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}

/** Whole-order remark → suggested rule, scope Project ("scope Order" — see lib/runs/feedback.ts module doc). */
export async function submitOrderRemarkAction(input: SubmitOrderRemarkInput): Promise<FeedbackActionResult> {
  const parsed = SubmitOrderRemarkInputSchema.parse(input);
  const { supabase, actorId } = await requireProjectsWriter();
  const service = createServiceClient();
  const result = await submitOrderRemark(supabase, service, { ...parsed, actorId });
  if (result.ok) revalidatePath(`/projects`, "layout");
  return result;
}
