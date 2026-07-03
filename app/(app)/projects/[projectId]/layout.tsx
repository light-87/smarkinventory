import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenTaskCount, getProject } from "@/lib/projects/queries";
import { ProjectHubHeader } from "@/components/projects/project-hub-header";
import { ProjectHubTabs } from "@/components/projects/project-hub-tabs";

interface ProjectHubLayoutProps {
  params: Promise<{ projectId: string }>;
  children: ReactNode;
}

/**
 * Project-hub shell (plan/tab-orders-projects.md R2-03): loads the project
 * once, renders the header + tab nav, and wraps every nested route —
 * including `boms/**` / `ordering/**` / `runs/**`, which bom-pipeline owns
 * (docs/OWNERSHIP.md) but still sit inside this shared chrome.
 */
export default async function ProjectHubLayout({ params, children }: ProjectHubLayoutProps) {
  const { projectId } = await params;

  const supabase = await createClient();
  const project = await getProject(supabase, projectId);
  if (!project) notFound();

  const openTaskCount = await getOpenTaskCount(supabase, projectId);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <ProjectHubHeader project={project} />
      <ProjectHubTabs projectId={projectId} openTaskCount={openTaskCount} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
