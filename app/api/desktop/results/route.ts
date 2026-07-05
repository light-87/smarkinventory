/**
 * POST /api/desktop/results — the desktop companion app lands its finished
 * sourcing results.
 *
 * Auth: same bearer-token + owner/employee gate as run-context. Payload is
 * validated against lib/desktop/sync.ts's zod contracts (mirroring
 * types/worker.ts shapes), results are written with the worker's idempotent
 * upsert semantics, and the run flips to "review" — the existing web review
 * / feedback / cart surfaces take over from there unchanged.
 */

import { NextResponse } from "next/server";
import { createBearerClient, createServiceClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { DesktopResultsPayloadSchema, ingestDesktopResults } from "@/lib/desktop/sync";

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
    return NextResponse.json({ error: "You don't have permission to submit sourcing results." }, { status: 403 });
  }

  const parsed = DesktopResultsPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid payload: ${parsed.error.issues[0]?.message ?? "schema mismatch"}` }, { status: 400 });
  }

  const service = createServiceClient(); // smark_agent_results is service-role-only RLS — documented exception
  const outcome = await ingestDesktopResults(service, parsed.data);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 422 });

  return NextResponse.json({ ok: true, written: outcome.written });
}
