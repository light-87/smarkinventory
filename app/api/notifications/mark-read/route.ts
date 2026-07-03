import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/types/db";

interface MarkReadBody {
  ids?: unknown;
  all?: unknown;
}

/**
 * POST /api/notifications/mark-read — body `{ ids: string[] }` or
 * `{ all: true }` (hooks/use-notifications.ts is the only caller today).
 *
 * Runs under the caller's own session (`lib/supabase/server`'s
 * `createClient()` — never the service role). `smark_notifications_update`'s
 * RLS policy already restricts writes to the caller's own rows (or every row
 * for the owner), so this route is a thin HTTP wrapper, not an authorization
 * boundary of its own — a mismatched id in `ids` just updates 0 rows rather
 * than erroring.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: MarkReadBody;
  try {
    body = (await request.json()) as MarkReadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (body.all === true) {
    const { error } = await supabase
      .from(TABLES.notifications)
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Provide ids: string[] or all: true" }, { status: 400 });
  }

  const { error } = await supabase.from(TABLES.notifications).update({ read_at: now }).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
