/**
 * lib/onboarding/helpers.ts — pure onboarding-completeness logic + the zod
 * shape for the `/onboarding` form (FEATURES: first-login gate for
 * engineers — DOB + date_of_joining + bank details, before anything else).
 *
 * Kept separate from `types/db.ts` (integrator-owned DB row contracts): this
 * is a package-local FORM/derivation shape, validated the same way
 * lib/expenses/validation.ts is — shared by the client form and re-validated
 * server-side in lib/onboarding/actions.ts (never trust the client).
 */

import { z } from "zod";
import { zDateOnly } from "@/types/db";

/** The subset of `smark_app_users` columns onboarding-completeness depends on. */
export interface OnboardingProfileFields {
  birth_date: string | null;
  date_of_joining: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
}

/**
 * True once DOB + date_of_joining + all four bank fields are present
 * (non-null, non-blank). PAN number is deliberately NOT part of this check —
 * it can be added later from Settings → My Profile; only these are
 * "required before using the rest of the app" per the business rule.
 */
export function isOnboardingComplete(profile: OnboardingProfileFields): boolean {
  const required: (string | null)[] = [
    profile.birth_date,
    profile.date_of_joining,
    profile.bank_account_name,
    profile.bank_account_number,
    profile.bank_ifsc,
    profile.bank_name,
  ];
  return required.every((value) => typeof value === "string" && value.trim().length > 0);
}

export const OnboardingFormSchema = z.object({
  birth_date: zDateOnly,
  date_of_joining: zDateOnly,
  bank_account_name: z.string().trim().min(1, "Account holder name is required").max(200),
  bank_account_number: z
    .string()
    .trim()
    .min(4, "Account number looks too short")
    .max(34)
    .regex(/^[A-Za-z0-9]+$/, "Digits/letters only"),
  bank_ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC (e.g. HDFC0001234)"),
  bank_name: z.string().trim().min(1, "Bank name is required").max(200),
});
export type OnboardingFormInput = z.infer<typeof OnboardingFormSchema>;

export type OnboardingValidation =
  | { ok: true; data: OnboardingFormInput }
  | { ok: false; error: string };

/**
 * Validates a submitted form, returning the first problem as a sentence.
 *
 * This exists as a function rather than a bare `.parse()` at the call site
 * because of what a throw does here. A ZodError raised inside a Server Action
 * is not caught as a form error — it escapes to the nearest error boundary and
 * replaces the entire screen with "Something went wrong", the real message
 * hidden behind a digest. On 2026-08-11 that turned a mistyped IFSC into a dead
 * screen: the FIRST page a new employee ever sees, killed by the first thing
 * they type into it.
 *
 * Only the first issue is surfaced. The form is six fields shown together, and
 * a list of every fault at once reads as an accusation; the first one is enough
 * to act on.
 */
export function validateOnboardingInput(input: unknown): OnboardingValidation {
  const result = OnboardingFormSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Please check the details you entered." };
}
