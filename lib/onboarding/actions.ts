"use server";

/**
 * lib/onboarding/actions.ts — Server Action backing `/onboarding`.
 *
 * Same idiom as lib/expenses/actions.ts: resolve the caller via the
 * per-request RLS-bound client (never the service client — these are
 * self-service writes to the caller's OWN rows), validate with zod
 * (lib/onboarding/helpers.ts), then write.
 *
 * Two-table write, in order:
 *  1. bank details → `smark_employee_private` (UPSERT on user_id; the
 *     self-or-owner-or-accountant RLS table — NEVER on smark_app_users,
 *     whose SELECT-all policy would expose them to every employee).
 *  2. DOB/DOJ + `onboarded_at = now()` → `smark_app_users` (own-row UPDATE
 *     policy). Stamped LAST so the onboarding gate only clears once the
 *     sensitive write has actually succeeded — a failure on step 1 leaves
 *     `onboarded_at` null and the employee still gated.
 *
 * SENSITIVE DATA NOTE: bank details never appear in a log line here or
 * anywhere else in this action — only ever passed straight through to the
 * Supabase client.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";
import { OnboardingFormSchema, type OnboardingFormInput } from "./helpers";

export interface OnboardingResult {
  ok: boolean;
  error?: string;
}

export async function completeOnboardingAction(input: OnboardingFormInput): Promise<OnboardingResult> {
  const parsed = OnboardingFormSchema.parse(input);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error: privateError } = await supabase
    .from(TABLES.employee_private)
    .upsert(
      {
        user_id: user.id,
        bank_account_name: parsed.bank_account_name,
        bank_account_number: parsed.bank_account_number,
        bank_ifsc: parsed.bank_ifsc,
        bank_name: parsed.bank_name,
      },
      { onConflict: "user_id" },
    );
  if (privateError) return { ok: false, error: privateError.message };

  const { error } = await supabase
    .from(TABLES.app_users)
    .update({
      birth_date: parsed.birth_date,
      date_of_joining: parsed.date_of_joining,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Thin wrapper the client form calls so a successful submit navigates into the app without a second round trip. */
export async function completeOnboardingAndRedirectAction(input: OnboardingFormInput): Promise<OnboardingResult> {
  const result = await completeOnboardingAction(input);
  if (result.ok) redirect("/dashboard");
  return result;
}
