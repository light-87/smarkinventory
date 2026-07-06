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
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStorageAdapter } from "@/lib/storage";
import { usernameToEmail } from "@/lib/auth/roles";
import { TABLES } from "@/types/db";
import { CreateEmployeeInputSchema, ProfileFormSchema, type CreateEmployeeInput, type ProfileFormInput, type ActionResult } from "./types";

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

/**
 * Owner-only: creates a new employee/accountant account — Settings → Users
 * & roles' "Add employee" form. Two steps, same shape as
 * scripts/seed-dev-users.ts (the dev-only equivalent this replaces for
 * production use):
 *  1. `auth.admin.createUser` (service-role only — no session client can do
 *     this) with the synthetic `{username}@smark.internal` email.
 *  2. Insert the `smark_app_users` profile row (role, active=true,
 *     created_by=caller). If this second step fails, the auth user still
 *     exists — surfaced in the error so the owner isn't left guessing why a
 *     "duplicate username" retry then also fails on auth.admin.createUser.
 * Double owner-check: the RLS-bound client's role lookup below is the actual
 * gate (a non-owner's `smark_role()` check fails before the service client is
 * ever touched); the service client itself bypasses RLS entirely, which is
 * exactly why this function must never run without that check first.
 */
export async function createEmployeeAction(input: CreateEmployeeInput): Promise<ActionResult<{ userId: string }>> {
  const parsed = CreateEmployeeInputSchema.parse(input);

  const sessionClient = await createClient();
  const { data: role, error: roleError } = await sessionClient.rpc("smark_role");
  if (roleError || role !== "owner") {
    return { ok: false, error: "Only the owner can add employees." };
  }
  const {
    data: { user: caller },
  } = await sessionClient.auth.getUser();

  const service = createServiceClient();
  const email = usernameToEmail(parsed.username);

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password: parsed.password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    const message = createError?.message ?? "Could not create the account.";
    return { ok: false, error: message.includes("already been registered") ? `"${parsed.username}" is already taken.` : message };
  }

  const { error: profileError } = await service.from(TABLES.app_users).insert({
    id: created.user.id,
    username: parsed.username,
    display_name: parsed.displayName,
    role: parsed.role,
    active: true,
    created_by: caller?.id ?? null,
  });
  if (profileError) {
    return {
      ok: false,
      error: `Account created, but the profile row failed (${profileError.message}) — the username may already be in use by a different account.`,
    };
  }

  revalidatePath("/settings/users");
  revalidatePath("/settings/employees");
  return { ok: true, userId: created.user.id };
}
