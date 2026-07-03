/**
 * lib/expenses/validation.ts — zod input schemas for the Expenses forms.
 * Shared by the client form (react-hook-form's zodResolver) and the Server
 * Actions (lib/expenses/actions.ts re-validates — never trust the client),
 * per CLAUDE.md "Forms: react-hook-form + zod".
 *
 * Deliberately narrower than `types/db.ts`'s `ExpenseRowSchema` — that
 * validates a full DB ROW (id/created_at/…); this validates the subset a
 * human types into the form.
 */

import { z } from "zod";
import { ExpenseAccountTypeSchema, ExpenseCategorySchema, ExpenseEntryTypeSchema, zDateOnly, zUuid } from "@/types/db";

/** A manually-created entry is never a draft — `is_draft` only ever starts
 * true from the checkout server action (cart-orders), never from this form —
 * so `account_id` is REQUIRED here (mirrors the DB CHECK
 * `smark_expenses_account_when_confirmed`). */
export const EntryFormSchema = z.object({
  entry_type: ExpenseEntryTypeSchema,
  amount: z.number().positive("Amount must be greater than 0"),
  entry_date: zDateOnly,
  category: ExpenseCategorySchema,
  account_id: zUuid,
  vendor: z.string().trim().max(200).nullable().optional(),
  gstin: z.string().trim().max(30).nullable().optional(),
  tax_amount: z.number().min(0).nullable().optional(),
  project_id: zUuid.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  attachment_url: z.string().trim().nullable().optional(),
});
export type EntryFormInput = z.infer<typeof EntryFormSchema>;

/**
 * Confirming a PO-spawned draft (Q-09): same shape, `account_id` still
 * required (the draft arrived with it null — this is exactly the field the
 * owner/accountant supplies to make it real).
 */
export const ConfirmDraftSchema = EntryFormSchema;
export type ConfirmDraftInput = EntryFormInput;

export const ExpenseAccountFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  account_type: ExpenseAccountTypeSchema,
});
export type ExpenseAccountFormInput = z.infer<typeof ExpenseAccountFormSchema>;
