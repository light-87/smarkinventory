/**
 * lib/orders/expense-write.ts — the ONLY bit of the (now-removed) Expenses
 * package that checkout still needs: drafting a `smark_expenses` row for a
 * placed PO (Q-09 / R2-12), and the role check that decides whether that
 * write is even attempted.
 *
 * The Expenses tab/UI (app/(app)/expenses/**, components/expenses/**,
 * lib/expenses/**) has been removed, but placing an order still auto-creates
 * a draft expense row so the underlying `smark_expenses`/`smark_expense_accounts`
 * tables stay populated for whoever/whatever reads them later (e.g. Project
 * income). This module is intentionally standalone — no dependency on the
 * deleted `lib/expenses/*` package, and no dependency on the `expenses`/
 * `expense_accounts` gateable Areas (removed from `lib/auth/roles.ts`'s
 * ROLE_MATRIX along with the UI). `canWriteExpenseDraft` below hardcodes the
 * exact same owner+accountant-only rule migration 0004_ordering_finance.sql
 * enforces at the RLS layer (`smark_expenses` INSERT is owner+accountant
 * only) — see lib/orders/checkout.ts's module doc for why this check has to
 * happen BEFORE the insert rather than after (never rely on RLS alone to
 * fail loudly here).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import type { Role } from "@/lib/auth/roles";

type DB = SupabaseClient<Database>;

/** Mirrors the former ROLE_MATRIX.expenses row (owner: full, employee: hidden, accountant: full). */
export function canWriteExpenseDraft(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

export interface DraftExpenseInput {
  amount: number;
  vendor: string | null;
  projectId: string | null;
  poNumber: string;
  orderId: string;
  actorId: string;
}

/** Inserts the draft `smark_expenses` row a placed PO spawns (Q-09 / R2-12). */
export async function insertDraftExpense(supabase: DB, input: DraftExpenseInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from(TABLES.expenses)
    .insert({
      entry_type: "expense",
      amount: input.amount,
      currency: "INR",
      entry_date: new Date().toISOString().slice(0, 10),
      category: "Materials",
      vendor: input.vendor,
      project_id: input.projectId,
      note: `PO ${input.poNumber}`,
      is_draft: true,
      source_order_id: input.orderId,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}
