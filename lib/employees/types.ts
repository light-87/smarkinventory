/**
 * lib/employees/types.ts — shared shapes for the employee profile +
 * documents surfaces (Settings → My Profile, Settings → Employees).
 *
 * Kept separate from `types/db.ts` (integrator-owned) — these are
 * package-local FORM/VIEW shapes, not DB row contracts, same split as
 * lib/expenses/types.ts.
 */

import { z } from "zod";
import { zDateOnly, type AppUserRow, type EmployeeDocumentRow, type EmployeePrivateRow } from "@/types/db";

/**
 * Settings → My Profile edit form. Every field optional at the zod level
 * (unlike onboarding's OnboardingFormSchema, which requires all of them) —
 * this form is also how PAN gets added later, and re-saving the profile
 * shouldn't force re-entering fields the user isn't touching right now.
 * Blank strings normalize to `null` before writing (lib/employees/actions.ts).
 */
export const ProfileFormSchema = z.object({
  birth_date: zDateOnly.nullable().optional(),
  date_of_joining: zDateOnly.nullable().optional(),
  pan_number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid 10-character PAN (e.g. ABCDE1234F)")
    .nullable()
    .optional()
    .or(z.literal("")),
  bank_account_name: z.string().trim().max(200).nullable().optional(),
  bank_account_number: z.string().trim().max(34).nullable().optional(),
  bank_ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC")
    .nullable()
    .optional()
    .or(z.literal("")),
  bank_name: z.string().trim().max(200).nullable().optional(),
});
export type ProfileFormInput = z.infer<typeof ProfileFormSchema>;

/** Non-sensitive profile view — the subset of `smark_app_users` the screens render. */
export type OwnProfile = Pick<
  AppUserRow,
  "id" | "username" | "display_name" | "role" | "birth_date" | "date_of_joining" | "onboarded_at"
>;

/**
 * The five sensitive fields as edited/rendered — sourced from
 * `smark_employee_private`, NEVER from `smark_app_users`. All nullable
 * (a fresh employee has no private row yet). This is the shape read into the
 * profile form and rendered (owner/accountant only) in the directory.
 */
export type PrivateFields = Pick<
  EmployeePrivateRow,
  "pan_number" | "bank_account_name" | "bank_account_number" | "bank_ifsc" | "bank_name"
>;

/** One row of the owner/accountant "Employees" directory: profile + private PII + their documents. */
export interface EmployeeDirectoryEntry {
  profile: OwnProfile;
  /** owner/accountant-only sensitive fields; null if the employee has no private row yet. */
  privateFields: PrivateFields | null;
  documents: EmployeeDocumentRow[];
}

/** Result envelope shared by mutating Server Actions (mirrors lib/expenses/types.ts). */
export type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Owner-only "Settings → Users & roles" add-employee form. `role` is
 * intentionally restricted to employee|accountant — owner accounts aren't
 * created through this surface. Username becomes `{username}@smark.internal`
 * (lib/auth/roles.ts usernameToEmail) — the same synthetic-email scheme
 * scripts/seed-dev-users.ts uses for local dev accounts.
 */
export const CreateEmployeeInputSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters.")
    .max(32, "At most 32 characters.")
    .regex(/^[a-z0-9._-]+$/, "Lowercase letters, numbers, dot, underscore, or hyphen only."),
  password: z.string().min(8, "At least 8 characters."),
  displayName: z.string().trim().min(1, "Enter a name.").max(200),
  role: z.enum(["employee", "accountant"]),
});
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeInputSchema>;
