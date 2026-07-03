import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner, canWrite } from "@/lib/auth/roles";
import { getProjectMembers, getProjectTimeEntries, listActiveUsers } from "@/lib/projects/queries";
import { TeamMembersCard } from "@/components/projects/team-members-card";
import { HoursTable } from "@/components/projects/hours-table";

export const metadata: Metadata = { title: "Team & hours" };

interface TeamPageProps {
  params: Promise<{ projectId: string }>;
}

/** Project hub → Team & hours (R2-04): roster (owner assigns) + per-member hour rollups. */
export default async function ProjectTeamPage({ params }: TeamPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [members, timeEntries, activeUsers, sessionUser] = await Promise.all([
    getProjectMembers(supabase, projectId),
    getProjectTimeEntries(supabase, projectId),
    listActiveUsers(supabase),
    getSessionUser(),
  ]);

  const role = sessionUser?.role ?? null;
  const owner = role != null && isOwner(role);
  const canLog = role != null && canWrite(role, "projects");

  return (
    <div className="flex flex-col gap-5">
      <TeamMembersCard projectId={projectId} members={members} activeUsers={activeUsers} isOwner={owner} />
      <HoursTable
        projectId={projectId}
        members={members}
        timeEntries={timeEntries}
        currentUserId={sessionUser?.id ?? null}
        isOwner={owner}
        canLog={canLog}
      />
    </div>
  );
}
