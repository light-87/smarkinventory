import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { getPmProjectFull, getProjectIncome } from "@/lib/pm/queries";
import { IncomeStrip } from "@/components/projects/income-strip";
import { ShowTimeToggle } from "@/components/projects/show-time-toggle";
import { ShareLinkControls } from "@/components/projects/share-link-controls";
import { SectionLabel } from "@/components/ui/card";

export const metadata: Metadata = { title: "Manage project" };

interface ManagePageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * Project hub → Manage (owner + accountant): the non-task "settings" that used
 * to crowd the Overview — payments received, client hours-visibility, and the
 * read-only client-portal share link. Keeps Overview focused on the work.
 */
export default async function ProjectManagePage({ params }: ManagePageProps) {
  const { projectId } = await params;
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  const role = sessionUser.role;
  const owner = isOwner(role);
  const canManage = owner || role === "accountant";
  if (!canManage) notFound();

  const supabase = await createClient();
  const [project, income] = await Promise.all([
    getPmProjectFull(supabase, projectId),
    getProjectIncome(supabase, projectId),
  ]);
  if (!project) return null; // layout already 404s a missing project

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <SectionLabel>Payments</SectionLabel>
        <IncomeStrip income={income} />
      </section>

      {owner && (
        <section className="flex flex-col gap-2">
          <div>
            <SectionLabel>Client sharing</SectionLabel>
            <p className="mt-1 text-caption text-faint">
              Control what the client sees and share a read-only progress link. Regenerating the link revokes the old one.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ShowTimeToggle projectId={projectId} initialValue={project.showTimeToClient} />
            <ShareLinkControls projectId={projectId} shareToken={project.shareToken} />
          </div>
        </section>
      )}
    </div>
  );
}
