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
