import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { accessFor } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getExpenseAccounts } from "@/lib/expenses/queries";
import { ExpenseAccountsCard } from "@/components/expenses/expense-accounts-card";

export const metadata: Metadata = { title: "Expense accounts" };

/**
 * `/settings/expense-accounts` (plan/tab-expenses.md §2C, FEATURES.md §16) —
 * owner-only CRUD, unlike `/expenses` itself (accountant reads accounts but
 * doesn't manage them — SCHEMA.md RLS: insert/update/delete on
 * `smark_expense_accounts` is owner-only). Gate on `"full"` specifically
 * (not `canSee`, which would also admit the accountant's `"read"`).
 */
export default async function ExpenseAccountsPage() {
  const user = await getSessionUser();
  if (!user || accessFor(user.role, "expense_accounts") !== "full") notFound();

  const supabase = await createClient();
  const accounts = await getExpenseAccounts(supabase);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <h1 className="mb-6 text-[24px] font-normal text-snow">Expense accounts</h1>
      <ExpenseAccountsCard accounts={accounts} />
    </div>
  );
}
