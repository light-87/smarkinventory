/**
 * app/api/labels/print-sheet/route.ts — batch label print [R2-35].
 *
 * POST: renders every `smark_qr_labels` row with `print_status=queued` onto
 * one Avery-layout PDF (lib/labels/avery.ts via lib/labels/print.ts), stores
 * it via `StoragePort` (Cloudflare R2 in prod, local disk in dev — CLAUDE.md:
 * never Supabase Storage), flips every rendered row to `printed`, and
 * returns the download URL. A Route Handler (not a Server Action) because it
 * returns a file-download URL from real binary work — a plain fetch from
 * the client component (components/receive/print-queue-strip.tsx) suits
 * that better than a server-action round trip.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { getStorageAdapter } from "@/lib/storage";
import { printQueuedLabels } from "@/lib/labels/print";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "receive")) {
    return NextResponse.json({ error: "You don't have permission to print labels." }, { status: 403 });
  }

  const result = await printQueuedLabels(supabase, getStorageAdapter());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ url: result.url, count: result.count, batchId: result.batchId });
}
