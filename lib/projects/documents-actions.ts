"use server";

/**
 * lib/projects/documents-actions.ts — Documents tab Server Actions (R2-16).
 * Upload is a Route Handler instead (`app/api/projects/documents/route.ts`)
 * — it does real file-transfer work (StoragePort → R2) and returns a URL, the
 * same rationale receive's print-sheet route documents. Delete is the one
 * mutation left here: "owner or uploader" per SCHEMA.md §7 (soft delete).
 */

import { revalidatePath } from "next/cache";
import { TABLES } from "@/types/db";
import { requireProjectsWriter } from "./auth";

export async function deleteProjectDocumentAction(projectId: string, documentId: string): Promise<void> {
  const { supabase, actorId, role } = await requireProjectsWriter();

  const { data: doc, error: fetchError } = await supabase
    .from(TABLES.project_documents)
    .select("id, uploaded_by")
    .eq("id", documentId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!doc) throw new Error("Document not found.");
  if (role !== "owner" && doc.uploaded_by !== actorId) {
    throw new Error("Only the owner or the uploader can delete this document.");
  }

  const { error } = await supabase
    .from(TABLES.project_documents)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/documents`);
}
