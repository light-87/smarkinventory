/**
 * POST /api/desktop/run-context — the desktop companion app starts a run.
 *
 * Auth: `Authorization: Bearer <supabase access token>` (same email/password
 * login as the web app — lib/supabase/server.ts createBearerClient). Gate:
 * owner/employee via smark_role, same as the Ordering Workspace actions.
 *
 * Creates a DESKTOP run (status "running", `plan.appMeta.executor =
 * "desktop"`, NO job rows — the always-on worker never touches it; see
 * lib/runs/enqueue.ts createDesktopRun) and returns the same aliased
 * WorkerRunConfig a worker run would get: lines, rules digest, distributor
 * sequence. The desktop runner turns that into the Claude Code session.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient, createServiceClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { createDesktopRun } from "@/lib/runs/enqueue";

const InputSchema = z.object({
  bomId: z.uuid(),
  lineLimit: z.coerce.number().int().min(1).max(500).optional(),
  // v0.2.0+ desktop clients render LCSC PN / part link / custom columns in
  // their own CLAUDE.md, so the server skips the note fold-in for them. Absent
  // (older installs) → the server folds those columns into the note instead.
  clientRendersColumns: z.boolean().optional(),
  // v0.3.0+ "Re-source all" checkbox. Absent/false → reuse lines already
  // sourced by the BOM's previous run (only source the remaining ones). True
  // → ignore prior results and source every to-order line from scratch.
  resourceAll: z.boolean().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });

  const supabase = createBearerClient(token);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "projects")) {
    return NextResponse.json({ error: "You don't have permission to start sourcing runs." }, { status: 403 });
  }

  let input: z.infer<typeof InputSchema>;
  try {
    input = InputSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bad request." }, { status: 400 });
  }

  const service = createServiceClient(); // digest read is owner-only RLS — same documented exception as enqueueRun
  const result = await createDesktopRun(supabase, service, {
    bomId: input.bomId,
    actorId: user.id,
    lineLimit: input.lineLimit,
    clientRendersColumns: input.clientRendersColumns,
    resourceAll: input.resourceAll,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

  return NextResponse.json({
    runId: result.runId,
    config: result.config,
    reviewPath: `/projects/${result.projectId}/runs/${result.runId}/review`,
  });
}
