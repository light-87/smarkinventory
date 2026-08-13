/**
 * app/api/labels/clear-queue/route.ts — empty the label print queue.
 *
 * The counterpart to `../print-sheet`, which now only renders. Splitting them
 * is the point: rendering the sheet used to mark every label printed, so simply
 * looking at what was waiting destroyed the queue (client, 2026-08-13). Clearing
 * is now something a person does once the labels are physically printed.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearPrintQueue } from "@/lib/labels/print";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: canEdit } = await supabase.rpc("smark_can_edit_inventory");
  if (!canEdit) {
    return NextResponse.json({ error: "You have view-only access to inventory." }, { status: 403 });
  }

  const result = await clearPrintQueue(supabase);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ cleared: result.cleared });
}
