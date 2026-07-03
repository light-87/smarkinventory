import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getRunConsoleData } from "@/lib/runs/queries";
import { RunConsoleView } from "@/components/run/run-console-view";

export const metadata: Metadata = { title: "Agent run" };

interface RunConsolePageProps {
  params: Promise<{ projectId: string; runId: string }>;
}

/**
 * Agent Run console (plan/tab-agent-run.md) — lands here straight from the
 * Ordering Workspace's "Run ordering →". Server-rendered snapshot (never
 * empty on first paint) + hooks/use-run-stream.ts picks up live streaming
 * from app/api/runs/[runId]/stream for any run not already settled.
 */
export default async function RunConsolePage({ params }: RunConsolePageProps) {
  const { projectId, runId } = await params;

  const supabase = await createClient();
  const service = createServiceClient();
  const data = await getRunConsoleData(supabase, service, runId);
  if (!data) notFound();
  // Cross-project-id guard mirrors the ordering workspace / BOM detail pages.
  if (data.project.id !== projectId) notFound();

  return <RunConsoleView projectId={projectId} data={data} />;
}
