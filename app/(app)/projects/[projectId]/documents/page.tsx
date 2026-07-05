import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite, isOwner } from "@/lib/auth/roles";
import { getProjectDocuments } from "@/lib/pm/queries";
import { DocumentUploadForm } from "@/components/projects/document-upload-form";
import { DocumentsList } from "@/components/projects/documents-list";

export const metadata: Metadata = { title: "Documents" };

interface DocumentsPageProps {
  params: Promise<{ projectId: string }>;
}

/** Project hub → Documents: named uploads to R2 (unchanged upload route + table), list/download/delete. */
export default async function ProjectDocumentsPage({ params }: DocumentsPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [sessionUser, documents] = await Promise.all([getSessionUser(), getProjectDocuments(supabase, projectId)]);

  const role = sessionUser?.role ?? null;
  const writable = role != null && canWrite(role, "projects");
  const owner = role != null && isOwner(role);

  return (
    <div className="flex flex-col gap-5">
      {writable && <DocumentUploadForm projectId={projectId} />}
      <DocumentsList projectId={projectId} documents={documents} currentUserId={sessionUser?.id ?? null} isOwner={owner} />
    </div>
  );
}
