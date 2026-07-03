import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite } from "@/lib/auth/roles";
import { getWorkspaceData } from "@/lib/runs/queries";
import { WorkspaceView } from "@/components/ordering/workspace-view";

export const metadata: Metadata = { title: "Ordering workspace" };

interface WorkspacePageProps {
  params: Promise<{ projectId: string; bomId: string }>;
}

/** Ordering Workspace (plan/tab-ordering-workspace.md) — entry point is the BOM's "Set up ordering →". */
export default async function OrderingWorkspacePage({ params }: WorkspacePageProps) {
  const { projectId, bomId } = await params;

  const supabase = await createClient();
  const service = createServiceClient();
  const [data, sessionUser] = await Promise.all([getWorkspaceData(supabase, service, bomId), getSessionUser()]);
  if (!data || data.bom.id !== bomId) notFound();
  // Cross-project-id guard mirrors app/(app)/projects/[projectId]/boms/[bomId]/page.tsx.
  if (data.project.id !== projectId) notFound();

  const writable = sessionUser != null && canWrite(sessionUser.role, "projects");

  return <WorkspaceView projectId={projectId} data={data} writable={writable} />;
}
