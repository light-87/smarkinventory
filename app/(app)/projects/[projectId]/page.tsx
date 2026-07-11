import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite, isOwner } from "@/lib/auth/roles";
import {
  getBugsForProject,
  getChangeRequests,
  getEmployeeKpiRollup,
  getOpenHold,
  getProjectProgress,
  getProjectTasks,
  listEngineers,
} from "@/lib/pm/queries";
import { getActiveReminderForTask, getProjectClientEmail } from "@/lib/reminders/queries";
import { TaskList } from "@/components/projects/task-list";
import { NewTaskForm } from "@/components/projects/new-task-form";
import { ApprovalsInbox } from "@/components/projects/approvals-inbox";
import { KpiSummary } from "@/components/projects/kpi-summary";
import { PmGuide } from "@/components/projects/pm-guide";
import { SectionLabel } from "@/components/ui/card";

export const metadata: Metadata = { title: "Project overview" };

interface OverviewPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * Project hub → Overview: focused on the work — progress + task list, owner
 * "Add task" and an Approvals inbox (only when bugs/change-requests are
 * pending), plus the engineer's own KPI when they have tasks here. Income,
 * client hours-visibility and the share link now live on the Manage tab.
 */
export default async function ProjectOverviewPage({ params }: OverviewPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  // layout.tsx already loads the project and 404s a missing one.
  const role = sessionUser.role;
  const owner = isOwner(role);
  const writable = canWrite(role, "projects");

  const [tasks, progress, engineers] = await Promise.all([
    getProjectTasks(supabase, projectId),
    getProjectProgress(supabase, projectId),
    owner ? listEngineers(supabase) : Promise.resolve([]),
  ]);

  const [holdEntries, myKpi] = await Promise.all([
    Promise.all(tasks.map(async (t) => [t.id, await getOpenHold(supabase, t.id)] as const)),
    role === "employee" ? getEmployeeKpiRollup(supabase, sessionUser.id) : Promise.resolve(null),
  ]);
  const holdByTask = new Map(holdEntries);

  const [clientEmail, reminderEntries] = await Promise.all([
    owner ? getProjectClientEmail(supabase, projectId) : Promise.resolve(null),
    owner
      ? Promise.all(
          tasks
            .filter((t) => holdByTask.get(t.id))
            .map(async (t) => [t.id, await getActiveReminderForTask(supabase, t.id)] as const),
        )
      : Promise.resolve([]),
  ]);
  const reminderByTask = new Map(reminderEntries);

  let bugCountByTask = new Map<string, number>();
  let taskTitleById = new Map<string, string>();
  let bugs: Awaited<ReturnType<typeof getBugsForProject>> = [];
  let changeRequests: Awaited<ReturnType<typeof getChangeRequests>> = [];
  if (owner) {
    [bugs, changeRequests] = await Promise.all([
      getBugsForProject(supabase, projectId),
      getChangeRequests(supabase, projectId, { status: "pending" }),
    ]);
    bugCountByTask = new Map();
    for (const bug of bugs) {
      if (bug.status === "confirmed" && bug.classification === "bug") {
        bugCountByTask.set(bug.taskId, (bugCountByTask.get(bug.taskId) ?? 0) + 1);
      }
    }
    taskTitleById = new Map(tasks.map((t) => [t.id, t.title]));
  }

  const engineerHasTasksHere = role === "employee" && tasks.some((t) => t.assignees.some((a) => a.userId === sessionUser.id));
  // Only surface the Approvals section when there's actually something to act on.
  const hasPendingApprovals = changeRequests.length > 0 || bugs.some((b) => b.status === "open");

  return (
    <div className="flex flex-col gap-5">
      {owner && <PmGuide />}

      {engineerHasTasksHere && myKpi && <KpiSummary kpi={myKpi} />}

      {owner && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Tasks</SectionLabel>
          <NewTaskForm projectId={projectId} engineers={engineers} />
        </div>
      )}

      <TaskList
        tasks={tasks}
        progress={progress}
        isOwner={owner}
        canWrite={writable}
        currentUserId={sessionUser.id}
        holdByTask={holdByTask}
        bugCountByTask={bugCountByTask}
        engineers={engineers}
        projectId={projectId}
        clientEmail={clientEmail}
        reminderByTask={reminderByTask}
      />

      {owner && hasPendingApprovals && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Approvals</SectionLabel>
          <ApprovalsInbox bugs={bugs} changeRequests={changeRequests} taskTitleById={taskTitleById} engineers={engineers} />
        </div>
      )}
    </div>
  );
}
