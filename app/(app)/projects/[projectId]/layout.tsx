import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { getPmProject } from "@/lib/pm/queries";
import { ProjectHubHeader } from "@/components/projects/project-hub-header";
import { ProjectHubTabs } from "@/components/projects/project-hub-tabs";

interface ProjectHubLayoutProps {
  params: Promise<{ projectId: string }>;
  children: ReactNode;
}

/**
 * Project-hub shell: loads the project once, renders the header + tab nav,
 * and wraps every nested route — including `boms/**` / `ordering/**` /
 * `runs/**`, which bom-pipeline owns (hard fence) but still sit inside this
 * shared chrome. Data source repointed from the deleted `lib/projects/queries`
 * to `lib/pm/queries` (0010).
 */
export default async function ProjectHubLayout({ params, children }: ProjectHubLayoutProps) {
  const { projectId } = await params;

  const supabase = await createClient();
  const project = await getPmProject(supabase, projectId);
  if (!project) notFound();

  // Manage tab (income + client sharing/visibility) is for owner + accountant.
  const sessionUser = await getSessionUser();
  const showManage = sessionUser?.role === "owner" || sessionUser?.role === "accountant";

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <ProjectHubHeader project={project} />
      <ProjectHubTabs projectId={projectId} showManage={showManage} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
