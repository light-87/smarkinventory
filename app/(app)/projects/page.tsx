import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { listProjects } from "@/lib/projects/queries";
import { NewProjectForm } from "@/components/projects/new-project-form";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Projects" };

interface ProjectsPageProps {
  searchParams: Promise<{ archived?: string }>;
}

/**
 * Projects list (`#/projects` → R2-03): new-project card, project cards
 * (name · client · derived status · BOM count · created), archived filter.
 */
export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const supabase = await createClient();
  const [projects, sessionUser] = await Promise.all([listProjects(supabase), getSessionUser()]);

  const writable = sessionUser != null && canWrite(sessionUser.role, "projects");
  const visible = projects.filter((p) => (showArchived ? p.archived_at != null : p.archived_at == null));
  const archivedCount = projects.length - projects.filter((p) => p.archived_at == null).length;

  const showEmptyState = visible.length === 0 && (showArchived || !writable);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-heading-sm font-normal text-snow">Projects</h1>
        <Link
          href={showArchived ? "/projects" : "/projects?archived=1"}
          className="text-[13px] text-smoke transition-colors hover:text-snow"
        >
          {showArchived ? "← Active projects" : `Archived${archivedCount > 0 ? ` (${archivedCount})` : ""} →`}
        </Link>
      </div>

      {showEmptyState ? (
        <EmptyState
          tone="subtle"
          title={showArchived ? "No archived projects" : "No projects yet"}
          description={
            showArchived
              ? "Archived client jobs will show up here."
              : "Your role can view Projects but can't create one."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {writable && !showArchived && <NewProjectForm />}
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
