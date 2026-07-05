"use server";

/**
 * lib/employees/actions.ts — Server Actions for Settings → My Profile.
 *
 * Same idiom as lib/expenses/actions.ts / lib/onboarding/actions.ts: resolve
 * the caller via the per-request RLS-bound client, validate with zod
 * (lib/employees/types.ts), then write. Every write here targets the
 * caller's OWN row (`id = user.id`) — migration 0011's
 * `smark_app_users_update` policy is the RLS twin of that restriction, this
 * is the friendly pre-check in front of it (a stray bug here still can't
 * reach another user's row; RLS is the real enforcement).
 *
 * SENSITIVE DATA: pan_number/bank_* values are read out of `input` and
 * handed straight to Supabase — never interpolated into an error message,
 * console.log, or thrown Error beyond the generic `error.message` Postgres
 * gives back (which never echoes column VALUES, only constraint names).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStorageAdapter } from "@/lib/storage";
import { TABLES } from "@/types/db";
import { ProfileFormSchema, type ProfileFormInput, type ActionResult } from "./types";

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function requireSelf() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/**
 * Writes the caller's own profile in two parts:
 *  - non-sensitive DOB/DOJ → `smark_app_users` (own-row UPDATE policy)
 *  - sensitive PAN/bank → `smark_employee_private` (UPSERT on user_id;
 *    self-or-owner-or-accountant RLS — a fresh employee has no row yet, so
 *    this is an insert-or-update, keyed by the PK `user_id`).
 * The two writes are independent statements; if the second fails the first
 * still landed (acceptable — DOB/DOJ aren't sensitive and re-saving is
 * idempotent), and the error is surfaced to the UI either way.
 */
export async function updateOwnProfileAction(input: ProfileFormInput): Promise<ActionResult> {
  const parsed = ProfileFormSchema.parse(input);
  const { supabase, userId } = await requireSelf();

  const { error: profileError } = await supabase
    .from(TABLES.app_users)
    .update({
      birth_date: blankToNull(parsed.birth_date ?? null),
      date_of_joining: blankToNull(parsed.date_of_joining ?? null),
    })
    .eq("id", userId);
  if (profileError) return { ok: false, error: profileError.message };

  const { error: privateError } = await supabase
    .from(TABLES.employee_private)
    .upsert(
      {
        user_id: userId,
        pan_number: blankToNull(parsed.pan_number ?? null),
        bank_account_name: blankToNull(parsed.bank_account_name ?? null),
        bank_account_number: blankToNull(parsed.bank_account_number ?? null),
        bank_ifsc: blankToNull(parsed.bank_ifsc ?? null),
        bank_name: blankToNull(parsed.bank_name ?? null),
      },
      { onConflict: "user_id" },
    );
  if (privateError) return { ok: false, error: privateError.message };

  revalidatePath("/settings/profile");
  revalidatePath("/settings/employees");
  return { ok: true };
}

/**
 * Signed download URL for one of the caller's own documents (or, for
 * owner/accountant, any employee's — RLS on `smark_employee_documents`
 * enforces exactly that visibility, same as the SELECT policy in migration
 * 0011). The client opens the returned URL directly — this action never
 * streams file bytes through the Next.js server itself.
 */
export async function getEmployeeDocumentDownloadUrlAction(documentId: string): Promise<ActionResult<{ url: string }>> {
  const { supabase } = await requireSelf();

  const { data: doc, error } = await supabase
    .from(TABLES.employee_documents)
    .select("file_url")
    .eq("id", documentId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!doc) return { ok: false, error: "Document not found." };

  try {
    const url = await getStorageAdapter().signedUrl(doc.file_url);
    return { ok: true, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create a download link.";
    return { ok: false, error: message };
  }
}
