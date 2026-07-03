"use server";

/**
 * lib/expenses/actions.ts — Server Actions for the Expenses surface.
 *
 * Same idiom as lib/receive/actions.ts: resolve the caller's session + role
 * via the per-request RLS-bound client (never the service client), gate with
 * lib/auth/roles's `canSee`/`canWrite` BEFORE touching the table so a
 * disallowed caller gets a clear message instead of an opaque RLS-denied
 * Postgres error, then validate the payload with zod (lib/expenses/validation.ts)
 * and write. RLS is still the real enforcement — this is the friendly layer
 * in front of it.
 *
 * Role note (FEATURES.md §2 / SCHEMA.md RLS FINAL): `expenses` is the one
 * area where accountant === owner (`full`); `expense_accounts` CRUD stays
 * owner-only (accountant only reads it, for the entry form's account
 * picker) — see `requireExpenseAccountsWriter` below.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { TABLES } from "@/types/db";
import {
  ConfirmDraftSchema,
  EntryFormSchema,
  ExpenseAccountFormSchema,
  type ConfirmDraftInput,
  type EntryFormInput,
  type ExpenseAccountFormInput,
} from "./validation";
import type { ActionResult } from "./types";

async function requireExpensesWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "expenses")) {
    throw new Error("You don't have permission to make changes in Expenses.");
  }
  return { supabase, actorId: user.id };
}

async function requireExpenseAccountsWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "expense_accounts")) {
    throw new Error("Only the owner can manage expense accounts.");
  }
  return { supabase, actorId: user.id };
}

function toEntryInsert(input: EntryFormInput, actorId: string, isDraft: boolean) {
  return {
    entry_type: input.entry_type,
    amount: input.amount,
    currency: "INR",
    entry_date: input.entry_date,
    category: input.category,
    account_id: input.account_id,
    vendor: input.vendor?.trim() || null,
    gstin: input.gstin?.trim() || null,
    tax_amount: input.tax_amount ?? null,
    project_id: input.project_id ?? null,
    note: input.note?.trim() || null,
    attachment_url: input.attachment_url?.trim() || null,
    is_draft: isDraft,
    created_by: actorId,
  };
}

function revalidateExpenses(): void {
  revalidatePath("/expenses");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entries
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createEntryAction(input: EntryFormInput): Promise<ActionResult> {
  const parsed = EntryFormSchema.parse(input);
  const { supabase, actorId } = await requireExpensesWriter();

  const { data, error } = await supabase
    .from(TABLES.expenses)
    .insert(toEntryInsert(parsed, actorId, false))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidateExpenses();
  return { ok: true, id: data.id };
}

export async function updateEntryAction(id: string, input: EntryFormInput): Promise<ActionResult> {
  const parsed = EntryFormSchema.parse(input);
  const { supabase } = await requireExpensesWriter();

  const { error } = await supabase
    .from(TABLES.expenses)
    .update({
      entry_type: parsed.entry_type,
      amount: parsed.amount,
      entry_date: parsed.entry_date,
      category: parsed.category,
      account_id: parsed.account_id,
      vendor: parsed.vendor?.trim() || null,
      gstin: parsed.gstin?.trim() || null,
      tax_amount: parsed.tax_amount ?? null,
      project_id: parsed.project_id ?? null,
      note: parsed.note?.trim() || null,
      attachment_url: parsed.attachment_url?.trim() || null,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };

  revalidateExpenses();
  return { ok: true, id };
}

/**
 * Confirms a PO-spawned draft (Q-09): supplies the account (+ anything else
 * the owner/accountant wants to correct) and flips `is_draft` false. Shares
 * the entry form's validation — a confirmed row must satisfy the exact same
 * "account required" rule as a manual entry (DB CHECK
 * `smark_expenses_account_when_confirmed`).
 */
export async function confirmDraftAction(id: string, input: ConfirmDraftInput): Promise<ActionResult> {
  const parsed = ConfirmDraftSchema.parse(input);
  const { supabase } = await requireExpensesWriter();

  const { error } = await supabase
    .from(TABLES.expenses)
    .update({
      entry_type: parsed.entry_type,
      amount: parsed.amount,
      entry_date: parsed.entry_date,
      category: parsed.category,
      account_id: parsed.account_id,
      vendor: parsed.vendor?.trim() || null,
      gstin: parsed.gstin?.trim() || null,
      tax_amount: parsed.tax_amount ?? null,
      project_id: parsed.project_id ?? null,
      note: parsed.note?.trim() || null,
      attachment_url: parsed.attachment_url?.trim() || null,
      is_draft: false,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };

  revalidateExpenses();
  return { ok: true, id };
}

/** Soft delete (audit-preserving — no hard-DELETE RLS policy exists on this table at all). */
export async function softDeleteEntryAction(id: string): Promise<ActionResult> {
  const { supabase } = await requireExpensesWriter();
  const { error } = await supabase
    .from(TABLES.expenses)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateExpenses();
  return { ok: true, id };
}

/** Undo for the delete toast (components/ui/toast.tsx's `undo` option). */
export async function restoreEntryAction(id: string): Promise<ActionResult> {
  const { supabase } = await requireExpensesWriter();
  const { error } = await supabase.from(TABLES.expenses).update({ deleted_at: null }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateExpenses();
  return { ok: true, id };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Expense accounts (Settings → Expense accounts, owner-only CRUD)
 * ──────────────────────────────────────────────────────────────────────────── */

function revalidateAccounts(): void {
  revalidatePath("/settings/expense-accounts");
  revalidatePath("/expenses");
}

export async function createExpenseAccountAction(input: ExpenseAccountFormInput): Promise<ActionResult> {
  const parsed = ExpenseAccountFormSchema.parse(input);
  const { supabase, actorId } = await requireExpenseAccountsWriter();

  const { data, error } = await supabase
    .from(TABLES.expense_accounts)
    .insert({ name: parsed.name, account_type: parsed.account_type, created_by: actorId })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidateAccounts();
  return { ok: true, id: data.id };
}

export async function updateExpenseAccountAction(id: string, input: ExpenseAccountFormInput): Promise<ActionResult> {
  const parsed = ExpenseAccountFormSchema.parse(input);
  const { supabase } = await requireExpenseAccountsWriter();

  const { error } = await supabase
    .from(TABLES.expense_accounts)
    .update({ name: parsed.name, account_type: parsed.account_type })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAccounts();
  return { ok: true, id };
}

/** Toggle active/retired — the safe "remove" (accounts are FK-referenced by entries; see report). */
export async function setExpenseAccountActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const { supabase } = await requireExpenseAccountsWriter();
  const { error } = await supabase.from(TABLES.expense_accounts).update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAccounts();
  return { ok: true, id };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Attachments (bill/receipt upload) — StoragePort seam, never Supabase Storage.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface UploadAttachmentResult {
  ok: true;
  url: string;
}

export async function uploadEntryAttachmentAction(
  formData: FormData,
): Promise<UploadAttachmentResult | { ok: false; error: string }> {
  await requireExpensesWriter(); // throws if not signed in / not permitted — same gate as writing the entry itself

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };

  const { getStorageAdapter } = await import("@/lib/storage");
  const buffer = new Uint8Array(await file.arrayBuffer());
  const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `expenses/${stamp}/${crypto.randomUUID()}-${safeName}`;

  const result = await getStorageAdapter().put({ key, body: buffer, contentType: file.type || undefined });
  return { ok: true, url: result.url };
}
