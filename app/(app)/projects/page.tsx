import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { effectiveCanSee } from "@/lib/rbac/access";
import { getEmployeeKpiRollup, getOpenHold, getMyTasks, listProjects, listProjectsForEmployee } from "@/lib/pm/queries";
import { NewProjectForm } from "@/components/projects/new-project-form";
import { ProjectCard } from "@/components/projects/project-card";
import { MyTasksList } from "@/components/projects/my-tasks-list";
import { KpiSummary } from "@/components/projects/kpi-summary";
import { PmGuide } from "@/components/projects/pm-guide";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Projects" };

interface ProjectsPageProps {
  searchParams: Promise<{ archived?: string }>;
}

/**
 * Projects surface (`/projects`, the single nav entry — lib/nav.ts): owner
 * sees every project + "New project"; employee sees their OWN assigned tasks
 * across every project (role branch, no separate route) + their KPI;
 * accountant sees the full read-only project list.
 */
export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const supabase = await createClient();
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  if (!effectiveCanSee(sessionUser.role, "projects", sessionUser.grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState title="No access" description="Your account doesn't have access to Projects. Ask an owner to grant the Project management module." />
      </div>
    );
  }

  if (sessionUser.role === "employee") {
    const [tasks, kpi, myProjects] = await Promise.all([
      getMyTasks(supabase, sessionUser.id),
      getEmployeeKpiRollup(supabase, sessionUser.id),
      listProjectsForEmployee(supabase, sessionUser.id),
    ]);
    const projectNameById = new Map(myProjects.map((p) => [p.id, p.name]));
    const holdEntries = await Promise.all(tasks.map(async (t) => [t.id, await getOpenHold(supabase, t.id)] as const));
    const holdByTask = new Map(holdEntries);
    const bugCountByTask = new Map<string, number>(); // confirmed-bug counts aren't needed for the engineer's own view

    return (
      <div className="mx-auto max-w-[900px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
        <h1 className="mb-4 text-heading-sm font-normal text-snow">My tasks</h1>
        <div className="mb-5">
          <KpiSummary kpi={kpi} />
        </div>
        <MyTasksList
          tasks={tasks}
          currentUserId={sessionUser.id}
          holdByTask={holdByTask}
          bugCountByTask={bugCountByTask}
          projectNameById={projectNameById}
        />
      </div>
    );
  }

  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const projects = await listProjects(supabase);
  const writable = isOwner(sessionUser.role);
  const visible = projects.filter((p) => (showArchived ? p.archivedAt != null : p.archivedAt == null));
  const archivedCount = projects.length - projects.filter((p) => p.archivedAt == null).length;

  const showEmptyState = visible.length === 0 && (showArchived || !writable);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-heading-sm font-normal text-snow">Projects</h1>
        <Link
          href={showArchived ? "/projects" : "/projects?archived=1"}
          className="text-[14px] text-smoke transition-colors hover:text-snow"
        >
          {showArchived ? "← Active projects" : `Archived${archivedCount > 0 ? ` (${archivedCount})` : ""} →`}
        </Link>
      </div>

      {writable && !showArchived && (
        <div className="mb-4">
          <PmGuide />
        </div>
      )}

      {showEmptyState ? (
        <EmptyState
          tone="subtle"
          title={showArchived ? "No archived projects" : "No projects yet"}
          description={showArchived ? "Archived client jobs will show up here." : "Your role can view Projects but can't create one."}
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
