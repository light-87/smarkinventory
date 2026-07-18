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
  // (0016) Personal contact — email + Indian-ish phone. Both optional/lenient
  // (re-saving the profile must not force re-entering untouched fields).
  email: z.string().trim().toLowerCase().email("Enter a valid email").nullable().optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9][0-9\s-]{6,19}$/, "Enter a valid phone number")
    .nullable()
    .optional()
    .or(z.literal("")),
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

/**
 * Owner-only edit of ANOTHER employee's profile (Settings → Employees). Same
 * field set as the self form, plus the target user's id and their display name
 * (which lives on `smark_app_users`, not the private table). The DB already
 * permits the owner clause on both tables — no migration needed.
 */
export const OwnerUpdateEmployeeSchema = ProfileFormSchema.extend({
  targetUserId: z.uuid(),
  display_name: z.string().trim().min(1, "Enter a name.").max(200),
});
export type OwnerUpdateEmployeeInput = z.infer<typeof OwnerUpdateEmployeeSchema>;

/** Owner resets any employee's password (Supabase Auth admin). */
export const ResetEmployeePasswordSchema = z.object({
  targetUserId: z.uuid(),
  password: z.string().min(8, "At least 8 characters."),
});
export type ResetEmployeePasswordInput = z.infer<typeof ResetEmployeePasswordSchema>;

/** Any user changes their own password. */
export const ChangeOwnPasswordSchema = z.object({
  password: z.string().min(8, "At least 8 characters."),
});
export type ChangeOwnPasswordInput = z.infer<typeof ChangeOwnPasswordSchema>;

/** Owner archives ("employee left") or reactivates an employee — never delete. */
export const SetEmployeeActiveSchema = z.object({
  targetUserId: z.uuid(),
  active: z.boolean(),
});
export type SetEmployeeActiveInput = z.infer<typeof SetEmployeeActiveSchema>;

/** Non-sensitive profile view — the subset of `smark_app_users` the screens render. */
export type OwnProfile = Pick<
  AppUserRow,
  "id" | "username" | "display_name" | "role" | "active" | "birth_date" | "date_of_joining" | "onboarded_at"
>;

/**
 * The sensitive/private fields as edited/rendered — sourced from
 * `smark_employee_private`, NEVER from `smark_app_users`. All nullable
 * (a fresh employee has no private row yet). This is the shape read into the
 * profile form and rendered (owner/accountant only) in the directory.
 */
export type PrivateFields = Pick<
  EmployeePrivateRow,
  "pan_number" | "bank_account_name" | "bank_account_number" | "bank_ifsc" | "bank_name" | "email" | "phone"
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
