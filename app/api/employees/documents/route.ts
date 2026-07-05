/**
 * app/api/employees/documents/route.ts — employee document upload (Settings
 * → My Profile: NDA, Aadhaar, PAN card image, client-labeled NDA, other).
 *
 * Route Handler rather than a Server Action for the same reason
 * app/api/projects/documents/route.ts (read-only reference, hard-fenced) is
 * one: real binary file transfer via multipart FormData suits `fetch` from a
 * client component better than a Server Action's serialized-args call.
 *
 * Always uploads for the CALLING user's own row — an employee cannot upload
 * a document under someone else's `user_id` (mirrors migration 0011's
 * `smark_employee_documents_insert` RLS policy, which enforces the same
 * restriction for non-owners at the DB layer regardless of what this route
 * does). `file_url` stores the StoragePort KEY, never the resolved
 * `stored.url` — the desktop-app companion's route
 * (app/api/desktop/**\/documents, out of scope here) already established the
 * "PostgREST/DB stores the key, signedUrl() resolves it at read time" split;
 * this route follows the same rule (app/api/projects/documents/route.ts, by
 * contrast, stores `stored.url` directly — that's a pre-existing quirk of
 * that read-only-reference route, not one this new route repeats).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStorageAdapter } from "@/lib/storage";
import { TABLES, EmployeeDocTypeSchema } from "@/types/db";

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const docTypeRaw = form.get("docType");
  const clientLabel = form.get("clientLabel");
  const displayNameRaw = form.get("displayName");
  const file = form.get("file");

  const docTypeParsed = EmployeeDocTypeSchema.safeParse(docTypeRaw);
  if (!docTypeParsed.success) {
    return NextResponse.json({ error: "Invalid document type." }, { status: 400 });
  }
  const docType = docTypeParsed.data;

  if ((docType === "nda_client" || docType === "other") && (typeof clientLabel !== "string" || !clientLabel.trim())) {
    return NextResponse.json(
      { error: docType === "nda_client" ? "Client name is required for a client NDA." : "A label is required." },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const displayName = typeof displayNameRaw === "string" && displayNameRaw.trim() ? displayNameRaw.trim() : file.name;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `employees/${user.id}/documents/${Date.now()}-${safeFileName(file.name)}`;

  let stored;
  try {
    stored = await getStorageAdapter().put({ key, body: bytes, contentType: file.type || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from(TABLES.employee_documents)
    .insert({
      user_id: user.id,
      doc_type: docType,
      client_label: typeof clientLabel === "string" && clientLabel.trim() ? clientLabel.trim() : null,
      display_name: displayName,
      file_url: stored.key,
      mime_type: stored.contentType,
      size_bytes: stored.size,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
