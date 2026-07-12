import { supabase } from "./supabase";

export interface BomPickerEntry {
  id: string;
  name: string;
  lineCount: number;
  sourcingStatus: string;
  createdAt: string;
  projectId: string;
  projectName: string;
  projectClient: string | null;
}

/**
 * Cross-project BOM list for the desktop picker — mirrors the flat-query +
 * in-memory join pattern used throughout the web app (e.g.
 * lib/ai-orc/queries.ts listRecentRuns), since PostgREST embeds aren't used
 * here. RLS on smark_boms/smark_projects scopes rows to what this signed-in
 * user can see, same as every other client-side read in the web app.
 */
export async function fetchBomsForPicker(): Promise<BomPickerEntry[]> {
  const { data: boms, error: bomsError } = await supabase
    .from("smark_boms")
    .select("id, name, project_id, line_count, sourcing_status, created_at")
    // "ordered" (types/db.ts BomSourcingStatusSchema) is the terminal state —
    // materials already ordered, nothing left to source. "draft"/"sourced"
    // stay visible since a sourced-but-not-ordered BOM may still want a re-run.
    .neq("sourcing_status", "ordered")
    .order("created_at", { ascending: false });
  if (bomsError) throw new Error(bomsError.message);

  const bomRows = boms ?? [];
  if (bomRows.length === 0) return [];

  const projectIds = Array.from(new Set(bomRows.map((b) => b.project_id)));
  const { data: projects, error: projectsError } = await supabase
    .from("smark_projects")
    .select("id, name, client")
    .in("id", projectIds);
  if (projectsError) throw new Error(projectsError.message);

  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));

  return bomRows.map((b) => {
    const project = projectById.get(b.project_id);
    return {
      id: b.id,
      name: b.name,
      lineCount: b.line_count ?? 0,
      sourcingStatus: b.sourcing_status ?? "unknown",
      createdAt: b.created_at,
      projectId: b.project_id,
      projectName: project?.name ?? "Unknown project",
      projectClient: project?.client ?? null,
    };
  });
}
