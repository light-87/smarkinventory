import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canSee } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getAgentRunCosts, getEntries, getExpenseAccounts, getExpenseRollups, getProjectOptions } from "@/lib/expenses/queries";
import { buildAiSpendSummary } from "@/lib/expenses/rollups";
import { ExpensesClient } from "@/components/expenses/expenses-client";

export const metadata: Metadata = { title: "Expenses" };

/**
 * `/expenses` (plan/tab-expenses.md) — owner full, accountant full
 * (Q-01 client amendment), employee HIDDEN. A role the matrix hides from
 * 404s the direct URL too — hiding the nav link isn't the enforcement
 * (RLS + this check are); an employee hitting this URL directly must see
 * the same 404 as any other made-up route, not a blank/broken page.
 */
export default async function ExpensesPage() {
  const user = await getSessionUser();
  if (!user || !canSee(user.role, "expenses")) notFound();

  const supabase = await createClient();

  const [entries, accounts, projects, rollups, agentRuns] = await Promise.all([
    getEntries(supabase),
    getExpenseAccounts(supabase),
    getProjectOptions(supabase),
    getExpenseRollups(supabase),
    getAgentRunCosts(supabase),
  ]);

  const aiSpend = buildAiSpendSummary(agentRuns);

  return (
    <ExpensesClient
      role={user.role}
      entries={entries}
      accounts={accounts}
      projects={projects}
      rollups={rollups}
      aiSpend={aiSpend}
    />
  );
}
