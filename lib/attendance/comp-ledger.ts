/**
 * lib/attendance/comp-ledger.ts — reads and writes for the comp-off day ledger
 * (migration 0020). The arithmetic lives in ./comp-days.ts; this file only
 * moves rows.
 *
 * Every function takes the caller's own client so it runs under their RLS,
 * matching lib/attendance/queries.ts. The one exception is the annual reset,
 * which is a scheduled job with no user behind it and is handed a
 * service-role client by its route.
 *
 * Ledger writes are owner-gated by RLS, which is not a restriction in
 * practice: every credit happens inside an owner-only approval, so an
 * employee can never mint their own days.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { annualResetEntries, compBalanceDays } from "./comp-days";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[attendance] ${context}: ${error.message}`);
}

export type CompLedgerSource = "overtime" | "comp_work" | "leave" | "grant" | "reset" | "manual";

export interface CompLedgerEntryView {
  id: string;
  userId: string;
  entryDate: string;
  deltaDays: number;
  sourceKind: CompLedgerSource;
  sourceId: string | null;
  periodYear: number | null;
  note: string | null;
  createdAt: string;
}

function toView(row: Record<string, unknown>): CompLedgerEntryView {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    entryDate: row.entry_date as string,
    deltaDays: Number(row.delta_days),
    sourceKind: row.source_kind as CompLedgerSource,
    sourceId: (row.source_id as string | null) ?? null,
    periodYear: (row.period_year as number | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** One employee's movements, newest first. RLS already limits an employee to their own. */
export async function getCompLedger(supabase: DB, userId: string): Promise<CompLedgerEntryView[]> {
  const { data, error } = await supabase
    .from(TABLES.comp_ledger)
    .select("id, user_id, entry_date, delta_days, source_kind, source_id, period_year, note, created_at")
    .eq("user_id", userId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  assertNoError(error, "smark_comp_ledger");
  return (data ?? []).map(toView);
}

/** Current comp-off balance in DAYS — the sum of the ledger. */
export async function getCompBalanceDays(supabase: DB, userId: string): Promise<number> {
  const { data, error } = await supabase.from(TABLES.comp_ledger).select("delta_days").eq("user_id", userId);
  assertNoError(error, "smark_comp_ledger (balance)");
  return compBalanceDays((data ?? []).map((r) => ({ deltaDays: Number(r.delta_days) })));
}

/** Balances for a set of employees in ONE query — the owner's attendance view needs a column of them. */
export async function getCompBalancesByUser(supabase: DB, userIds: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (userIds.length === 0) return balances;

  const { data, error } = await supabase.from(TABLES.comp_ledger).select("user_id, delta_days").in("user_id", userIds);
  assertNoError(error, "smark_comp_ledger (balances)");

  const byUser = new Map<string, number[]>();
  for (const row of data ?? []) {
    const list = byUser.get(row.user_id as string) ?? [];
    list.push(Number(row.delta_days));
    byUser.set(row.user_id as string, list);
  }
  for (const userId of userIds) {
    balances.set(userId, compBalanceDays((byUser.get(userId) ?? []).map((deltaDays) => ({ deltaDays }))));
  }
  return balances;
}

export interface PostLedgerEntryInput {
  userId: string;
  entryDate: string;
  deltaDays: number;
  sourceKind: CompLedgerSource;
  sourceId?: string | null;
  periodYear?: number | null;
  note?: string | null;
  createdBy: string | null;
}

/**
 * Records one movement. A zero delta is dropped rather than written — the
 * table rejects it, and "nothing happened" is not worth an audit row.
 */
export async function postLedgerEntry(supabase: DB, input: PostLedgerEntryInput): Promise<void> {
  if (input.deltaDays === 0) return;
  const { error } = await supabase.from(TABLES.comp_ledger).insert({
    user_id: input.userId,
    entry_date: input.entryDate,
    delta_days: input.deltaDays,
    source_kind: input.sourceKind,
    source_id: input.sourceId ?? null,
    period_year: input.periodYear ?? null,
    note: input.note ?? null,
    created_by: input.createdBy,
  });
  assertNoError(error, "smark_comp_ledger (insert)");
}

/**
 * Drops the entry a request previously produced.
 *
 * Called before every re-decide, so approving → rejecting → approving lands
 * on exactly one entry instead of stacking credits, and a rejection actually
 * takes back the days an earlier approval gave.
 */
export async function clearLedgerEntryForSource(supabase: DB, sourceKind: CompLedgerSource, sourceId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.comp_ledger)
    .delete()
    .eq("source_kind", sourceKind)
    .eq("source_id", sourceId);
  assertNoError(error, "smark_comp_ledger (clear)");
}

/**
 * Re-points a request's ledger entry at `deltaDays`: clears whatever it had,
 * then writes the new movement if there is one. Idempotent, so a decide action
 * can call it unconditionally.
 */
export async function syncLedgerEntryForSource(
  supabase: DB,
  input: PostLedgerEntryInput & { sourceId: string },
): Promise<void> {
  await clearLedgerEntryForSource(supabase, input.sourceKind, input.sourceId);
  await postLedgerEntry(supabase, input);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-employee annual entitlement
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CompSettingsView {
  userId: string;
  annualDays: number;
}

export async function getCompSettings(supabase: DB, userId: string): Promise<CompSettingsView> {
  const { data, error } = await supabase
    .from(TABLES.comp_settings)
    .select("user_id, annual_days")
    .eq("user_id", userId)
    .maybeSingle();
  assertNoError(error, "smark_comp_settings");
  return { userId, annualDays: data ? Number(data.annual_days) : 0 };
}

/** Entitlements for everyone who has a row — absent means 0, so callers default. */
export async function listCompSettings(supabase: DB): Promise<Map<string, number>> {
  const { data, error } = await supabase.from(TABLES.comp_settings).select("user_id, annual_days");
  assertNoError(error, "smark_comp_settings (list)");
  return new Map((data ?? []).map((r) => [r.user_id as string, Number(r.annual_days)]));
}

/** Owner sets (or clears) an employee's yearly entitlement. Upsert — the row may not exist yet. */
export async function setCompSettings(supabase: DB, ownerId: string, userId: string, annualDays: number): Promise<void> {
  const { error } = await supabase
    .from(TABLES.comp_settings)
    .upsert({ user_id: userId, annual_days: annualDays, updated_by: ownerId }, { onConflict: "user_id" });
  assertNoError(error, "smark_comp_settings (upsert)");
}

/* ────────────────────────────────────────────────────────────────────────────
 * The January job
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AnnualResetResult {
  year: number;
  usersProcessed: number;
  resetEntries: number;
  grantEntries: number;
}

/**
 * Zeroes every active employee's leftover balance and grants the new year's
 * entitlement to whoever is flagged for one.
 *
 * Safe to run repeatedly: the ledger carries a unique index on
 * (user_id, source_kind, period_year), so a second run for the same year
 * inserts nothing. That matters because this is driven by a daily cron rather
 * than a single precisely-timed job — if 1 January is missed, the next day
 * still puts things right.
 *
 * Takes a service-role client: it acts for the company, not for a signed-in
 * user, and it must see every employee regardless of RLS.
 */
export async function runAnnualCompReset(
  serviceClient: DB,
  year: number,
  entryDate: string,
): Promise<AnnualResetResult> {
  const { data: users, error: usersError } = await serviceClient
    .from(TABLES.app_users)
    .select("id")
    .eq("role", "employee")
    .eq("active", true);
  assertNoError(usersError, "smark_app_users (annual reset)");

  const userIds = (users ?? []).map((u) => u.id as string);
  const [balances, settings] = await Promise.all([
    getCompBalancesByUser(serviceClient, userIds),
    listCompSettings(serviceClient),
  ]);

  // Which people already have this year's rows — the idempotency check, read
  // once rather than per user.
  const { data: existing, error: existingError } = await serviceClient
    .from(TABLES.comp_ledger)
    .select("user_id, source_kind")
    .eq("period_year", year);
  assertNoError(existingError, "smark_comp_ledger (annual reset probe)");
  const done = new Set((existing ?? []).map((r) => `${r.user_id}:${r.source_kind}`));

  let resetEntries = 0;
  let grantEntries = 0;

  for (const userId of userIds) {
    const { reset, grant } = annualResetEntries(balances.get(userId) ?? 0, settings.get(userId) ?? 0);

    if (reset !== 0 && !done.has(`${userId}:reset`)) {
      await postLedgerEntry(serviceClient, {
        userId,
        entryDate,
        deltaDays: reset,
        sourceKind: "reset",
        periodYear: year,
        note: `Year-end reset — unused comp-off cleared for ${year}`,
        createdBy: null,
      });
      resetEntries++;
    }

    if (grant > 0 && !done.has(`${userId}:grant`)) {
      await postLedgerEntry(serviceClient, {
        userId,
        entryDate,
        deltaDays: grant,
        sourceKind: "grant",
        periodYear: year,
        note: `Annual comp-off entitlement for ${year}`,
        createdBy: null,
      });
      grantEntries++;
    }
  }

  return { year, usersProcessed: userIds.length, resetEntries, grantEntries };
}
