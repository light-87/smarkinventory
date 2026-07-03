/**
 * lib/expenses/queries.ts — server-only data fetching for the Expenses
 * surface (plan/tab-expenses.md). Every function takes an already-created
 * request Supabase client (lib/supabase/server.ts `createClient()`) so it
 * runs under the caller's session + RLS — never the service-role client.
 *
 * Style matches the sibling packages already landed (lib/dashboard/queries.ts,
 * app/(app)/shelves/queries.ts): hand-joins via follow-up `.in()` queries
 * instead of PostgREST embedded selects (types/db.ts's `Database` generic
 * carries no `Relationships` metadata for supabase-js to type embeds
 * against).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExpenseRollupRow } from "@/types/db";
import { ExpenseAccountRowSchema, ExpenseRollupRowSchema, ExpenseRowSchema, TABLES, VIEWS } from "@/types/db";
import type { AccountOption, EntryListItem, ProjectOption } from "./types";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[expenses] ${context}: ${error.message}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entries — soft-deleted rows are excluded HERE (the one query every other
 * layer trusts); see tests/unit/expenses-filter.test.ts for the guard.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getEntries(supabase: DB): Promise<EntryListItem[]> {
  const { data, error } = await supabase
    .from(TABLES.expenses)
    .select("*")
    .is("deleted_at", null)
    .order("entry_date", { ascending: false });
  assertNoError(error, "smark_expenses");

  const rows = ExpenseRowSchema.array().parse(data ?? []);
  if (rows.length === 0) return [];

  const accountIds = Array.from(new Set(rows.map((r) => r.account_id).filter((v): v is string => v != null)));
  const projectIds = Array.from(new Set(rows.map((r) => r.project_id).filter((v): v is string => v != null)));

  const [accountsRes, projectsRes] = await Promise.all([
    accountIds.length
      ? supabase.from(TABLES.expense_accounts).select("id, name").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    projectIds.length
      ? supabase.from(TABLES.projects).select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  assertNoError(accountsRes.error, "smark_expense_accounts (join)");
  assertNoError(projectsRes.error, "smark_projects (join)");

  const accountNameById = new Map((accountsRes.data ?? []).map((a) => [a.id, a.name]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    ...r,
    accountName: r.account_id ? (accountNameById.get(r.account_id) ?? null) : null,
    projectName: r.project_id ? (projectNameById.get(r.project_id) ?? null) : null,
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reference data — accounts + projects
 * ──────────────────────────────────────────────────────────────────────────── */

/** All accounts (active + retired) — Settings needs both; the entry form filters to `active`. */
export async function getExpenseAccounts(supabase: DB): Promise<AccountOption[]> {
  const { data, error } = await supabase.from(TABLES.expense_accounts).select("*").order("name", { ascending: true });
  assertNoError(error, "smark_expense_accounts");
  return ExpenseAccountRowSchema.array().parse(data ?? []);
}

export async function getProjectOptions(supabase: DB): Promise<ProjectOption[]> {
  const { data, error } = await supabase.from(TABLES.projects).select("id, name").order("name", { ascending: true });
  assertNoError(error, "smark_projects (options)");
  return data ?? [];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rollups — the whole view, once; charts slice it client-side per bucket/period.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getExpenseRollups(supabase: DB): Promise<ExpenseRollupRow[]> {
  const { data, error } = await supabase.from(VIEWS.expense_rollups).select("*");
  assertNoError(error, "v_expense_rollups");
  return ExpenseRollupRowSchema.array().parse(data ?? []);
}

/* ────────────────────────────────────────────────────────────────────────────
 * AI spend meter [R2-37] — from smark_agent_runs, not the expense ledger.
 * Read directly (this package doesn't own ai-memory/worker) — a plain
 * SELECT of two columns, gated by whatever RLS already applies to that
 * table; renders honestly at zero until runs exist.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AgentRunCostRow {
  actual_cost: number | null;
  created_at: string;
}

export async function getAgentRunCosts(supabase: DB): Promise<AgentRunCostRow[]> {
  const { data, error } = await supabase.from(TABLES.agent_runs).select("actual_cost, created_at");
  // Tolerate a missing/inaccessible table gracefully — this widget is a
  // trust surface that must render zero-state, never crash the whole page,
  // if the worker/ai-memory package hasn't landed runs yet in this env.
  if (error) return [];
  return data ?? [];
}
