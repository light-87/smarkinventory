/**
 * app/api/projects/documents/route.ts — Documents tab upload [R2-16].
 *
 * POST (multipart form: `projectId`, `displayName`, optional `note`, `file`):
 * pushes the file through `StoragePort` (Cloudflare R2 in prod, local disk
 * in dev/test — CLAUDE.md: files never live in Supabase Storage), then
 * inserts the `smark_project_documents` row. A Route Handler rather than a
 * Server Action for the same reason receive's print-sheet route is one
 * (`app/api/labels/print-sheet/route.ts`): real binary file transfer, a
 * plain `fetch`-with-FormData from the client component suits it better.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/auth/roles";
import { getStorageAdapter } from "@/lib/storage";
import { TABLES } from "@/types/db";

function safeFileName(name: string): string {
  const trimmed = name.trim() || "file";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("smark_role");
  if (!role || !canWrite(role, "projects")) {
    return NextResponse.json({ error: "You don't have permission to upload documents." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const projectId = form.get("projectId");
  const displayName = form.get("displayName");
  const note = form.get("note");
  const file = form.get("file");

  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "Missing project." }, { status: 400 });
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    return NextResponse.json({ error: "A display name is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `projects/${projectId}/documents/${Date.now()}-${safeFileName(file.name)}`;

  let stored;
  try {
    stored = await getStorageAdapter().put({ key, body: bytes, contentType: file.type || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from(TABLES.project_documents)
    .insert({
      project_id: projectId,
      display_name: displayName.trim(),
      file_url: stored.url,
      mime_type: stored.contentType,
      size_bytes: stored.size,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data.id, url: stored.url });
}
