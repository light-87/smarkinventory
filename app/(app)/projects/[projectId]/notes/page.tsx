import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite, isOwner } from "@/lib/auth/roles";
import { getProject, getProjectActivities, getProjectMembers } from "@/lib/projects/queries";
import { NewActivityForm } from "@/components/projects/new-activity-form";
import { NotesFeed } from "@/components/projects/notes-feed";

export const metadata: Metadata = { title: "Notes & tasks" };

interface NotesPageProps {
  params: Promise<{ projectId: string }>;
}

/** Project hub → Notes & tasks (R2-06): Note/Meeting/Change/Task feed, task assignee/due/done. */
export default async function ProjectNotesPage({ params }: NotesPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [project, activities, members, sessionUser] = await Promise.all([
    getProject(supabase, projectId),
    getProjectActivities(supabase, projectId),
    getProjectMembers(supabase, projectId),
    getSessionUser(),
  ]);
  if (!project) return null;

  const role = sessionUser?.role ?? null;
  const writable = role != null && canWrite(role, "projects") && project.archived_at == null;
  const owner = role != null && isOwner(role);
  const assignableMembers = members.map((m) => m.user).filter((u): u is NonNullable<typeof u> => u != null);

  return (
    <div className="flex flex-col gap-5">
      {writable && <NewActivityForm projectId={projectId} members={assignableMembers} />}
      <NotesFeed
        projectId={projectId}
        activities={activities}
        currentUserId={sessionUser?.id ?? null}
        isOwner={owner}
      />
    </div>
  );
}
