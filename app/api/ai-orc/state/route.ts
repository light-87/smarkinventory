/**
 * app/api/ai-orc/state/route.ts — polling endpoint for the /ai_orc
 * observatory. GET, owner-only (403 otherwise), optional `?run=<id>` adds the
 * deep dive. Uses the service client AFTER the role gate because
 * `smark_order_jobs`/`smark_agent_results` are service-role-only tables by
 * RLS design (migration 0004) — same documented pattern as
 * `getWorkspaceData` in lib/runs/queries.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getRunDeepDive, getWorkersState, listRecentRuns } from "@/lib/ai-orc/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: role } = await supabase.rpc("smark_role");
  if (role !== "owner") {
    return NextResponse.json({ error: "The AI orchestration console is owner-only." }, { status: 403 });
  }

  const service = createServiceClient();
  const runId = request.nextUrl.searchParams.get("run");

  try {
    const [workers, runs, run] = await Promise.all([
      getWorkersState(service),
      listRecentRuns(service),
      runId ? getRunDeepDive(service, runId) : Promise.resolve(null),
    ]);
    return NextResponse.json({ workers, runs, run, now: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load observatory state.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
