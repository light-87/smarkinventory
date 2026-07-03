/**
 * worker/src/db.ts — service-role Supabase client + the worker's OWN local
 * row shapes for the handful of columns it actually reads/writes.
 *
 * Why local shapes instead of importing `types/db.ts`: docs/OWNERSHIP.md
 * scopes this package to `worker/**` + `types/worker.ts` ONLY — it does not
 * own (and must not import) the app's `types/db.ts`, which pulls in `zod`
 * and is versioned alongside the Next.js app's migrations/tests. The worker
 * is a standalone Bun service with its own deploy lifecycle (Railway/Fly/
 * Render); keeping its DB-shape knowledge local and minimal means a schema
 * ripple only requires the integrator to ping the worker owner, never a
 * forced coupled deploy. These interfaces are intentionally NARROW (only
 * the columns this file's functions touch) and are kept in sync with
 * `supabase/migrations/0004_ordering_finance.sql` by hand.
 *
 * `smark_order_jobs` / `smark_agent_results` / `smark_ai_aliases` are
 * SERVICE-ROLE ONLY per that migration's RLS section — this client (using
 * `SUPABASE_SERVICE_ROLE_KEY`) is the only correct way for ANY code to
 * touch them, which is exactly what the worker is.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { JobStatus, MpnMatchQuality, PartLifecycleStatus, RunStatus } from "../../types/worker";
import type { WorkerEnv } from "./env";

/** `smark_order_jobs` — worker claim queue (see supabase/migrations/0004_ordering_finance.sql §5). */
export interface OrderJobRow {
  id: string;
  run_id: string;
  bom_line_id: string;
  plan: unknown;
  status: JobStatus;
  claimed_at: string | null;
  attempts: number;
  created_at: string;
  updated_at: string | null;
}

/** `smark_agent_runs` — the columns the worker reads/writes. */
export interface AgentRunRow {
  id: string;
  bom_id: string;
  status: RunStatus;
  concurrency_preset: "economy" | "balanced" | "thorough";
  fanout_width: number;
  depth_per_item: number;
  per_site_cap: number;
  est_cost: number | null;
  actual_cost: number | null;
  plan: unknown;
  rules_doc_version: number | null;
}

/** `smark_agent_results` — one row per (run, bom_line, distributor option). */
export interface AgentResultInsert {
  run_id: string;
  bom_line_id: string;
  part_id: string | null;
  distributor_id: string;
  price: number | null;
  qty_breaks: Array<{ qty: number; unit_price: number }> | null;
  stock_qty: number | null;
  mpn_match: MpnMatchQuality;
  package_match: boolean;
  part_status: PartLifecycleStatus | null;
  order_link: string | null;
  is_recommended: boolean;
  raw: unknown;
  confidence: number | null;
}

export interface AgentResultRow extends AgentResultInsert {
  id: string;
  selected: boolean;
  selected_by: string | null;
  selected_at: string | null;
  created_at: string;
  updated_at: string | null;
}

/** `smark_distributors` — read-only lookup (name/api_type) when a run config didn't fully resolve it. */
export interface DistributorRow {
  id: string;
  name: string;
  api_type: "rest" | "browse" | "none";
  active: boolean;
}

/**
 * Minimal typed surface over the four tables the worker touches. Deliberately
 * `unknown`-typed at the Supabase generic level (no `Database` import) —
 * every call site below casts through the narrow interfaces above instead.
 */
export type ServiceRoleClient = SupabaseClient;

export function createServiceRoleClient(env: Pick<WorkerEnv, "supabaseUrl" | "supabaseServiceRoleKey">): ServiceRoleClient {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
