import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getProjectHeader, listBomsForProject } from "@/lib/bom/queries";
import { BomListTable } from "@/components/bom/bom-list-table";

export const metadata: Metadata = { title: "BOMs" };

interface BomsPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * BOMs section of the project hub — `app/(app)/projects/[projectId]/layout.tsx`
 * (projects-hub) already renders the project header + section tabs above
 * this, so this page only renders the BOM list itself (plan/tab-orders-
 * projects.md R2-03 "BOMs" hub section).
 */
export default async function BomsPage({ params }: BomsPageProps) {
  const { projectId } = await params;

  const supabase = await createClient();
  const [project, sessionUser] = await Promise.all([getProjectHeader(supabase, projectId), getSessionUser()]);
  if (!project) notFound();

  const boms = await listBomsForProject(supabase, projectId);
  const writable = sessionUser != null && canWrite(sessionUser.role, "projects");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-smoke">
          {boms.length === 0 ? "No BOMs yet" : `${boms.length} ${boms.length === 1 ? "BOM" : "BOMs"}`} — each named, its
          own sourcing pipeline.
        </p>
        {writable && (
          <Link
            href={`/projects/${projectId}/boms/new`}
            className="inline-flex h-11 items-center justify-center rounded-full bg-smark-orange px-[22px] text-sm font-medium text-obsidian transition-colors hover:bg-smark-orange-hover"
          >
            + Upload / Create BOM
          </Link>
        )}
      </div>

      <BomListTable projectId={projectId} boms={boms} />
    </div>
  );
}
