"use server";

/**
 * lib/receive/actions.ts — Server Actions for the Receive surface.
 *
 * Thin wrappers: validate with zod (lib/receive/types.ts), resolve the
 * caller's session + role via the per-request RLS-bound client
 * (lib/supabase/server.ts — never the service client, per CLAUDE.md "Server
 * data via supabase server client + RLS"), then delegate to the pure
 * lib/receive/core.ts functions that do the actual writes. Role-gated the
 * same way RLS gates it (owner/employee full, accountant read-only —
 * FEATURES.md §2) so a read-only caller gets a clear error instead of an
 * opaque RLS-denied Postgres error.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canSee, canWrite } from "@/lib/auth/roles";
import { undoMovement } from "@/lib/movements";
import * as core from "./core";
import { findPartForTopUp, type TopUpPreview } from "./queries";
import {
  CustomFieldTemplateInputSchema,
  NewPartFormSchema,
  OnboardingAssignInputSchema,
  PutAwayInputSchema,
  TopUpInputSchema,
  type CustomFieldTemplateInput,
  type NewPartFormInput,
  type OnboardingAssignInput,
  type PutAwayInput,
  type TopUpInput,
} from "./types";

async function requireReceiveReader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canSee(role, "receive")) {
    throw new Error("You don't have access to Receive.");
  }
  return { supabase, actorId: user.id };
}

async function requireReceiveWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "receive")) {
    throw new Error("You don't have permission to make changes on Receive.");
  }
  return { supabase, actorId: user.id };
}

/** "Find" preview on the Top-up card — read-only, so accountant (read-only Receive) can look too. */
export async function findPartForTopUpAction(code: string): Promise<TopUpPreview | null> {
  const { supabase } = await requireReceiveReader();
  return findPartForTopUp(supabase, code);
}

export async function createNewPartAction(
  input: NewPartFormInput,
  force = false,
): Promise<core.CreateNewPartResult> {
  const parsed = NewPartFormSchema.parse(input);
  const { supabase, actorId } = await requireReceiveWriter();
  const result = await core.createNewPart(supabase, actorId, parsed, { force });
  if (result.ok) revalidatePath("/receive");
  return result;
}

export async function addCustomFieldTemplateAction(
  input: CustomFieldTemplateInput,
): Promise<core.AddCustomFieldResult> {
  const parsed = CustomFieldTemplateInputSchema.parse(input);
  const { supabase, actorId } = await requireReceiveWriter();
  const result = await core.addCustomFieldTemplate(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/receive");
  return result;
}

export async function topUpExistingPartAction(input: TopUpInput): Promise<core.TopUpResult> {
  const parsed = TopUpInputSchema.parse(input);
  const { supabase, actorId } = await requireReceiveWriter();
  const result = await core.topUpExistingPart(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/receive");
  return result;
}

export async function putAwayArrivalLineAction(input: PutAwayInput): Promise<core.PutAwayResult> {
  const parsed = PutAwayInputSchema.parse(input);
  const { supabase, actorId } = await requireReceiveWriter();
  const result = await core.putAwayArrivalLine(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/receive");
  return result;
}

export type UndoReceiveMovementResult = { ok: true } | { ok: false; error: string };

/**
 * Reverses a top-up / put-away movement (FEATURES.md §9 "every stock
 * mutation ... is undoable") — the Undo pill on those toasts, mirroring
 * `hooks/use-scanner.ts`'s scan-add undo and part-detail's Adjust undo.
 * Note: for put-away this only reverses the STOCK movement, not the order
 * line's `arrived` status — reversing that too is out of scope here (see
 * this package's report).
 */
export async function undoReceiveMovementAction(movementId: string): Promise<UndoReceiveMovementResult> {
  const { supabase, actorId } = await requireReceiveWriter();
  try {
    await undoMovement(supabase, movementId, actorId);
    revalidatePath("/receive");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not undo that movement." };
  }
}

export async function assignOnboardingLocationAction(
  input: OnboardingAssignInput,
): Promise<core.OnboardingAssignResult> {
  const parsed = OnboardingAssignInputSchema.parse(input);
  const { supabase, actorId } = await requireReceiveWriter();
  const result = await core.assignOnboardingLocation(supabase, actorId, parsed);
  if (result.ok) revalidatePath("/receive");
  return result;
}
