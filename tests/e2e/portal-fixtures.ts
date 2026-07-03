import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * tests/e2e/portal-fixtures.ts — self-contained DB seeding for the portal
 * package's Playwright specs (tests/e2e/portal-*.spec.ts).
 *
 * Deliberately does NOT import tests/helpers/supabase.ts: that file pulls in
 * `bun:test` (for its `describeWithDb` gate), which only resolves inside
 * Bun's own test runtime. `bunx playwright test` runs specs under Node (the
 * same reason tests/e2e/dashboard-smoke.spec.ts guards its whole body behind
 * `typeof process.versions.bun === "undefined"`) — importing `bun:test`
 * there would throw at module load, before a single test ran. This file
 * duplicates just the tiny bit of env-loading + service-client construction
 * it needs (mirroring tests/helpers/supabase.ts's own approach), scoped to
 * this package's own specs.
 */
function loadDotEnvLocal(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function createPortalServiceClient(): SupabaseClient {
  if (!url || !serviceRoleKey) {
    throw new Error(
      "portal e2e fixtures: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — run `bunx supabase start` (docs/DEV.md) with .env.local filled in.",
    );
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface PortalDemoProject {
  token: string;
  projectId: string;
  cleanup: () => Promise<void>;
}

/** Short, collision-resistant suffix for fixture names within one test run. */
function tag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Seeds one project + phase timeline (one done, one active, one parallel,
 * one buffer, one footnote row — full row_kind coverage for the timeline
 * spec) + a shared update/document + a deliberately UNSHARED update/document
 * carrying an obvious ₹ figure and a stock-quantity mention (the leak-scan
 * spec's negative control: if either ever surfaces on `/p/:token`, sharing
 * is broken).
 */
export async function seedPortalDemoProject(): Promise<PortalDemoProject> {
  const supabase = createPortalServiceClient();
  const token = `e2e-portal-${tag()}`;

  const { data: project, error: projectError } = await supabase
    .from("smark_projects")
    .insert({
      name: "Acme Control Panel",
      client: "Acme Industries",
      share_token: token,
      est_start_date: "2026-06-01",
      est_delivery_date: "2026-08-15",
    })
    .select("id")
    .single();
  if (projectError || !project) {
    throw new Error(`portal e2e seed: project insert failed: ${projectError?.message}`);
  }
  const projectId = project.id as string;

  const { error: phasesError } = await supabase.from("smark_project_phases").insert([
    {
      project_id: projectId,
      sort_order: 1,
      name: "Schematic Design + Review",
      row_kind: "phase",
      status: "done",
      start_date: "2026-06-01",
      end_date: "2026-06-10",
      duration_text: "9-10 days",
    },
    {
      project_id: projectId,
      sort_order: 2,
      name: "PCB Layout",
      row_kind: "phase",
      status: "active",
      start_date: "2026-06-11",
      end_date: "2026-06-25",
      duration_text: "14 days",
    },
    {
      project_id: projectId,
      sort_order: 3,
      name: "Enclosure design",
      row_kind: "parallel",
      status: "pending",
      duration_text: "Running parallel with layout",
    },
    {
      project_id: projectId,
      sort_order: 4,
      name: "Buffer / vendor delays",
      row_kind: "buffer",
      status: "pending",
      start_date: "2026-06-26",
      end_date: "2026-06-30",
      duration_text: "5 days",
    },
    {
      project_id: projectId,
      sort_order: 5,
      name: "Assembly + test",
      row_kind: "phase",
      status: "pending",
      start_date: "2026-07-01",
      end_date: "2026-07-20",
      duration_text: "20 days",
    },
    {
      project_id: projectId,
      sort_order: 6,
      name: "Note1",
      row_kind: "footnote",
      status: "pending",
      notes: "Enclosure not included in this quote.",
    },
  ]);
  if (phasesError) throw new Error(`portal e2e seed: phases insert failed: ${phasesError.message}`);

  const { error: sharedActivityError } = await supabase.from("smark_project_activities").insert({
    project_id: projectId,
    type: "note",
    title: "Layout kicked off",
    body: "PCB layout is underway — on track for the estimate.",
    shared_to_portal: true,
  });
  if (sharedActivityError) throw new Error(`portal e2e seed: shared activity failed: ${sharedActivityError.message}`);

  const { error: hiddenActivityError } = await supabase.from("smark_project_activities").insert({
    project_id: projectId,
    type: "note",
    title: "Internal cost note",
    body: "Component spend so far: ₹48,250. 320 units on hand.",
    shared_to_portal: false,
  });
  if (hiddenActivityError) throw new Error(`portal e2e seed: hidden activity failed: ${hiddenActivityError.message}`);

  const { error: sharedDocError } = await supabase.from("smark_project_documents").insert({
    project_id: projectId,
    display_name: "Enclosure drawing v2.pdf",
    file_url: "https://example-r2.smarkstock.test/enclosure-v2.pdf",
    mime_type: "application/pdf",
    size_bytes: 245_000,
    shared_to_portal: true,
  });
  if (sharedDocError) throw new Error(`portal e2e seed: shared document failed: ${sharedDocError.message}`);

  const { error: hiddenDocError } = await supabase.from("smark_project_documents").insert({
    project_id: projectId,
    display_name: "Internal BOM pricing.xlsx",
    file_url: "https://example-r2.smarkstock.test/internal-pricing.xlsx",
    shared_to_portal: false,
  });
  if (hiddenDocError) throw new Error(`portal e2e seed: hidden document failed: ${hiddenDocError.message}`);

  return {
    token,
    projectId,
    cleanup: async () => {
      await supabase.from("smark_project_documents").delete().eq("project_id", projectId);
      await supabase.from("smark_project_activities").delete().eq("project_id", projectId);
      await supabase.from("smark_project_phases").delete().eq("project_id", projectId);
      await supabase.from("smark_projects").delete().eq("id", projectId);
    },
  };
}

/** A project with no phases/updates/documents shared at all — timeline "nothing shared yet" states. */
export async function seedPortalEmptyProject(): Promise<PortalDemoProject> {
  const supabase = createPortalServiceClient();
  const token = `e2e-portal-empty-${tag()}`;

  const { data: project, error } = await supabase
    .from("smark_projects")
    .insert({ name: "Empty Timeline Co", share_token: token })
    .select("id")
    .single();
  if (error || !project) throw new Error(`portal e2e seed: empty project insert failed: ${error?.message}`);
  const projectId = project.id as string;

  return {
    token,
    projectId,
    cleanup: async () => {
      await supabase.from("smark_projects").delete().eq("id", projectId);
    },
  };
}

/** An archived project — its token must 404 (FEATURES §11/§16). */
export async function seedPortalArchivedProject(): Promise<PortalDemoProject> {
  const supabase = createPortalServiceClient();
  const token = `e2e-portal-archived-${tag()}`;

  const { data: project, error } = await supabase
    .from("smark_projects")
    .insert({ name: "Archived Co", share_token: token, archived_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !project) throw new Error(`portal e2e seed: archived project insert failed: ${error?.message}`);
  const projectId = project.id as string;

  return {
    token,
    projectId,
    cleanup: async () => {
      await supabase.from("smark_projects").delete().eq("id", projectId);
    },
  };
}
