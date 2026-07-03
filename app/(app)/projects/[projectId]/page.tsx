import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite, isOwner } from "@/lib/auth/roles";
import { getPhases, getProject, getProjectDerivedStatus, getProjectPayments } from "@/lib/projects/queries";
import { ProjectStatusPill } from "@/components/projects/status-pill";
import { ProgressOnTrackCard } from "@/components/projects/progress-on-track-card";
import { PhaseTimelineEditor } from "@/components/projects/phase-timeline-editor";
import { PaymentsStrip } from "@/components/projects/payments-strip";
import { ShareLinkControls } from "@/components/projects/share-link-controls";
import { ArchiveControl } from "@/components/projects/archive-control";

export const metadata: Metadata = { title: "Project overview" };

interface OverviewPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * Project hub → Overview (plan/tab-orders-projects.md R2-03/14/15/30/32):
 * derived status, phase timeline + progress/on-track, payments strip
 * (owner+accountant), share-link controls + archive (owner-only).
 */
export default async function ProjectOverviewPage({ params }: OverviewPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [project, phases, statusInfo, sessionUser] = await Promise.all([
    getProject(supabase, projectId),
    getPhases(supabase, projectId),
    getProjectDerivedStatus(supabase, projectId),
    getSessionUser(),
  ]);
  if (!project) return null; // layout.tsx already 404s when the project is missing

  const role = sessionUser?.role ?? null;
  const writable = role != null && canWrite(role, "projects") && project.archived_at == null;
  const owner = role != null && isOwner(role);
  const canSeePayments = role === "owner" || role === "accountant";
  const payments = canSeePayments ? await getProjectPayments(supabase, projectId) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <ProjectStatusPill status={statusInfo.status} />
        <span className="text-caption text-smoke">
          {statusInfo.bomCount} {statusInfo.bomCount === 1 ? "BOM" : "BOMs"}
        </span>
      </div>

      <ProgressOnTrackCard
        projectId={projectId}
        phases={phases}
        completedAt={project.completed_at}
        canConfirm={owner && project.archived_at == null}
      />

      <PhaseTimelineEditor projectId={projectId} phases={phases} writable={writable} canAdvance={owner && project.archived_at == null} />

      {canSeePayments && <PaymentsStrip payments={payments} />}

      {owner && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ShareLinkControls projectId={projectId} shareToken={project.share_token} />
          <ArchiveControl projectId={projectId} archived={project.archived_at != null} />
        </div>
      )}
    </div>
  );
}
