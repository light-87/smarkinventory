#!/usr/bin/env bun
/**
 * scripts/seed-demo-run.ts — writes a self-contained, COMPLETED mock agent
 * run so the Dashboard's agent-activity card (and a future Order Review
 * screen) has realistic data in local dev.
 *
 * WHY A SCRIPT, NOT supabase/seed.sql (integrator decision, WF-3):
 * `supabase/seed.sql` is CONFIG-ONLY by its own header ("NOT demo/test
 * data") and — critically — an agent run FK-references `smark_boms`, which
 * FK-references `smark_projects`; seeding those into the shared `supabase db
 * reset` would inject a phantom project into the baseline that 20+ e2e specs
 * and the RLS matrix run against. The repo's established pattern for demo
 * data is a service-role seed via script / inline per-spec fixture
 * (scripts/seed-canonical-demo.ts, worker/tests/helpers.ts `seedRunFixture`,
 * tests/e2e/bom-upload.spec.ts) — this is that script for the run pipeline.
 * Run on demand: `bun run db:seed-demo`.
 *
 * SERVICE-ROLE KEY, SCRIPT-ONLY — same rationale as
 * scripts/seed-canonical-demo.ts: an operator/dev-seed tool, never an app
 * route. Idempotent: guarded by a fixed project name; re-runs reuse the
 * existing project/BOM and skip if the run already exists.
 *
 * The seeded run lands at status `review` (the realistic end state of the
 * mock pipeline: worker planned + item-agents finished, awaiting the human
 * review), with `plan.config.lines` populated (what the dashboard reads for
 * "N lines"), one `smark_order_jobs` row per line marked `done`, and a couple
 * of `smark_agent_results` options per line — one recommended + selected.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { TABLES, type AgentResultRow } from "@/types/db";

const DEMO_PROJECT_NAME = "SmarkStock Demo — Ordering Run";
const DEMO_BOM_NAME = "Demo Controller BOM v1";

interface DemoLineSpec {
  lineNo: number;
  references: string;
  qty: number;
  value: string;
  footprint: string;
  mpn: string;
  manufacturer: string;
  lcscPn: string;
}

const DEMO_LINES: readonly DemoLineSpec[] = [
  { lineNo: 1, references: "C3,C4,C5", qty: 30, value: "100nF 50V X7R", footprint: "C0603", mpn: "CL10B104KB8NNNC", manufacturer: "Samsung", lcscPn: "C1525" },
  { lineNo: 2, references: "R7,R8", qty: 20, value: "10K 1% 1/10W", footprint: "R0402", mpn: "RC0402FR-0710KL", manufacturer: "Yageo", lcscPn: "C25744" },
  { lineNo: 3, references: "U2", qty: 10, value: "3.3V LDO 1A", footprint: "SOT-223", mpn: "AMS1117-3.3", manufacturer: "AMS", lcscPn: "C6186" },
];

async function main() {
  const supabase = createServiceClient();

  // ── Owner (started_by; nullable — fall back to null if none seeded yet) ──
  const owner = await supabase.from(TABLES.app_users).select("id").eq("role", "owner").limit(1).maybeSingle();
  const ownerId: string | null = (owner.data as { id: string } | null)?.id ?? null;

  // ── Distributors (seeded by supabase/seed.sql) ──
  const dists = await supabase.from(TABLES.distributors).select("id, name");
  if (dists.error) throw new Error(`distributors lookup failed: ${dists.error.message}`);
  const distByName = new Map((dists.data ?? []).map((d) => [d.name as string, d.id as string]));
  const digikey = distByName.get("Digikey");
  const mouser = distByName.get("Mouser");
  if (!digikey || !mouser) {
    throw new Error("Digikey/Mouser rows missing from smark_distributors — run `bunx supabase db reset` first (seed.sql seeds them).");
  }

  // ── Project (idempotent by name) ──
  const existingProject = await supabase.from(TABLES.projects).select("id").eq("name", DEMO_PROJECT_NAME).maybeSingle();
  if (existingProject.error) throw new Error(`project lookup failed: ${existingProject.error.message}`);
  let projectId = (existingProject.data as { id: string } | null)?.id ?? null;
  if (!projectId) {
    const ins = await supabase.from(TABLES.projects).insert({ name: DEMO_PROJECT_NAME, client: "Demo Client Pvt Ltd" }).select("id").single();
    if (ins.error) throw new Error(`project insert failed: ${ins.error.message}`);
    projectId = (ins.data as { id: string }).id;
  }

  // ── BOM (idempotent by project + name) ──
  const existingBom = await supabase.from(TABLES.boms).select("id").eq("project_id", projectId).eq("name", DEMO_BOM_NAME).maybeSingle();
  if (existingBom.error) throw new Error(`bom lookup failed: ${existingBom.error.message}`);
  let bomId = (existingBom.data as { id: string } | null)?.id ?? null;
  if (!bomId) {
    const ins = await supabase.from(TABLES.boms).insert({ project_id: projectId, name: DEMO_BOM_NAME, build_qty: 10, sourcing_status: "sourced" }).select("id").single();
    if (ins.error) throw new Error(`bom insert failed: ${ins.error.message}`);
    bomId = (ins.data as { id: string }).id;
  }

  // ── Already seeded? A run for this BOM means we're done (idempotent). ──
  const existingRun = await supabase.from(TABLES.agent_runs).select("id").eq("bom_id", bomId).limit(1).maybeSingle();
  if (existingRun.error) throw new Error(`run lookup failed: ${existingRun.error.message}`);
  if (existingRun.data) {
    console.log(`Demo run already present (project "${DEMO_PROJECT_NAME}", bom ${bomId}, run ${(existingRun.data as { id: string }).id}). Nothing to do.`);
    return;
  }

  // ── BOM lines (reuse if present) ──
  const existingLines = await supabase.from(TABLES.bom_lines).select("id, line_no").eq("bom_id", bomId).order("line_no", { ascending: true });
  if (existingLines.error) throw new Error(`bom_lines lookup failed: ${existingLines.error.message}`);
  let lineRows = (existingLines.data ?? []) as { id: string; line_no: number | null }[];
  if (lineRows.length === 0) {
    const ins = await supabase
      .from(TABLES.bom_lines)
      .insert(
        DEMO_LINES.map((l) => ({
          bom_id: bomId,
          line_no: l.lineNo,
          references: l.references,
          qty: l.qty,
          value: l.value,
          footprint: l.footprint,
          mpn: l.mpn,
          manufacturer: l.manufacturer,
          lcsc_pn: l.lcscPn,
          dnp: false,
          match_state: "to_order" as const,
        })),
      )
      .select("id, line_no");
    if (ins.error) throw new Error(`bom_lines insert failed: ${ins.error.message}`);
    lineRows = (ins.data ?? []) as { id: string; line_no: number | null }[];
  }
  const lineById = new Map(lineRows.map((r) => [r.line_no ?? 0, r.id] as const));

  // ── The run: plan envelope shaped like the enqueue path (types/worker.ts
  //    WorkerRunPlanColumn) — dashboard reads plan.config.lines for the
  //    line count; getWorkspaceData reads plan.appMeta.buildQtyAtRun; the run
  //    header reads plan.masterPlan.narration. ──
  const runId = crypto.randomUUID();
  const planEnvelope = {
    config: {
      runId,
      bomId,
      lines: DEMO_LINES.map((l) => ({ bomLineId: lineById.get(l.lineNo) ?? null, qty: l.qty * 10, value: l.value, packageName: l.footprint, mpn: l.mpn, lcscPn: l.lcscPn })),
      concurrencyPreset: "balanced",
    },
    masterPlan: {
      narration: "Planned 3 lines across Digikey → Mouser. All identifiable by MPN; package match required on every line.",
      searches: DEMO_LINES.map((l) => ({ bomLineId: lineById.get(l.lineNo) ?? null, distributorOrder: ["Digikey", "Mouser"] })),
      skip: [],
    },
    appMeta: { buildQtyAtRun: 10 },
  };

  const runIns = await supabase.from(TABLES.agent_runs).insert({
    id: runId,
    bom_id: bomId,
    status: "review",
    concurrency_preset: "balanced",
    fanout_width: 3,
    depth_per_item: 3,
    per_site_cap: 2,
    est_cost: 18.5,
    actual_cost: 16.25,
    plan: planEnvelope,
    rules_doc_version: null,
    started_by: ownerId,
  });
  if (runIns.error) throw new Error(`agent_run insert failed: ${runIns.error.message}`);

  // ── One done job per line ──
  const jobsIns = await supabase.from(TABLES.order_jobs).insert(
    DEMO_LINES.map((l) => ({
      run_id: runId,
      bom_line_id: lineById.get(l.lineNo)!,
      plan: { bomLineId: lineById.get(l.lineNo), distributorOrder: ["Digikey", "Mouser"], notes: null, ruleHit: null },
      status: "done" as const,
    })),
  );
  if (jobsIns.error) throw new Error(`order_jobs insert failed: ${jobsIns.error.message}`);

  // ── Two result options per line — Digikey recommended + selected. ──
  const results: Array<Partial<AgentResultRow>> = [];
  for (const l of DEMO_LINES) {
    const bomLineId = lineById.get(l.lineNo)!;
    results.push({
      run_id: runId, bom_line_id: bomLineId, part_id: null, distributor_id: digikey,
      price: Number((Math.random() * 2 + 0.3).toFixed(2)), qty_breaks: null, stock_qty: 12000,
      mpn_match: "exact", package_match: true, part_status: "active",
      order_link: "https://www.digikey.in/", is_recommended: true, raw: null, confidence: 92,
      selected: true, selected_by: ownerId, selected_at: new Date().toISOString(),
    });
    results.push({
      run_id: runId, bom_line_id: bomLineId, part_id: null, distributor_id: mouser,
      price: Number((Math.random() * 2 + 0.35).toFixed(2)), qty_breaks: null, stock_qty: 8400,
      mpn_match: "exact", package_match: true, part_status: "active",
      order_link: "https://www.mouser.in/", is_recommended: false, raw: null, confidence: 88,
      selected: false, selected_by: null, selected_at: null,
    });
  }
  const resIns = await supabase.from(TABLES.agent_results).insert(results);
  if (resIns.error) throw new Error(`agent_results insert failed: ${resIns.error.message}`);

  console.log(`Seeded demo run ${runId}: project "${DEMO_PROJECT_NAME}" · bom ${bomId} · ${DEMO_LINES.length} lines · status review · ${results.length} results.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
