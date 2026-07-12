import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getProjectHeader, listBomsForProject } from "@/lib/bom/queries";
import { getLatestRunStatusByBomIds } from "@/lib/runs/queries";
import { BomListTable } from "@/components/bom/bom-list-table";

export const metadata: Metadata = { title: "BOMs" };

interface BomsPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ archived?: string }>;
}

/**
 * BOMs section of the project hub — `app/(app)/projects/[projectId]/layout.tsx`
 * (projects-hub) already renders the project header + section tabs above
 * this, so this page only renders the BOM list itself (plan/tab-orders-
 * projects.md R2-03 "BOMs" hub section).
 */
export default async function BomsPage({ params, searchParams }: BomsPageProps) {
  const { projectId } = await params;
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const supabase = await createClient();
  const [project, sessionUser] = await Promise.all([getProjectHeader(supabase, projectId), getSessionUser()]);
  if (!project) notFound();

  const allBoms = await listBomsForProject(supabase, projectId);
  const writable = sessionUser != null && canWrite(sessionUser.role, "projects");

  const visible = allBoms.filter((b) => (showArchived ? b.archivedAt != null : b.archivedAt == null));
  const archivedCount = allBoms.filter((b) => b.archivedAt != null).length;

  // "In review" CTA — surface the BOM's most recent run when it's sitting in
  // review, whether that run was desktop- or worker-created (docs/desktop-
  // web-handoff-prompt.md §2).
  const latestRunByBom = await getLatestRunStatusByBomIds(supabase, visible.map((b) => b.savedRunId));
  const reviewRunIdByBom = new Map(
    Array.from(latestRunByBom.entries())
      .filter(([, run]) => run.status === "review")
      .map(([bomId, run]) => [bomId, run.runId] as const),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-smoke">
          {showArchived
            ? `${visible.length} archived ${visible.length === 1 ? "BOM" : "BOMs"} — hidden, no demand.`
            : `${visible.length === 0 ? "No BOMs yet" : `${visible.length} ${visible.length === 1 ? "BOM" : "BOMs"}`} — each named, its own sourcing pipeline.`}
        </p>
        <div className="flex items-center gap-4">
          {(showArchived || archivedCount > 0) && (
            <Link
              href={showArchived ? `/projects/${projectId}/boms` : `/projects/${projectId}/boms?archived=1`}
              className="text-[14px] text-smoke transition-colors hover:text-snow"
            >
              {showArchived ? "← Active BOMs" : `Archived (${archivedCount}) →`}
            </Link>
          )}
          {writable && !showArchived && (
            <Link
              href={`/projects/${projectId}/boms/new`}
              className="inline-flex h-11 items-center justify-center rounded-full bg-lime px-[22px] text-sm font-medium text-obsidian transition-colors hover:bg-lime-hover"
            >
              + Upload / Create BOM
            </Link>
          )}
        </div>
      </div>

      <BomListTable
        projectId={projectId}
        boms={visible}
        writable={writable}
        reviewRunIdByBom={reviewRunIdByBom}
        mode={showArchived ? "archived" : "active"}
      />
    </div>
  );
}
