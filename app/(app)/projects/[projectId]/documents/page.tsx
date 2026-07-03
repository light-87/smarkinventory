import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { canWrite, isOwner } from "@/lib/auth/roles";
import { getProject, getProjectDocuments } from "@/lib/projects/queries";
import { DocumentUploadForm } from "@/components/projects/document-upload-form";
import { DocumentsList } from "@/components/projects/documents-list";

export const metadata: Metadata = { title: "Documents" };

interface DocumentsPageProps {
  params: Promise<{ projectId: string }>;
}

/** Project hub → Documents (R2-16): named uploads to R2, list/download/delete. */
export default async function ProjectDocumentsPage({ params }: DocumentsPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [project, documents, sessionUser] = await Promise.all([
    getProject(supabase, projectId),
    getProjectDocuments(supabase, projectId),
    getSessionUser(),
  ]);
  if (!project) return null;

  const role = sessionUser?.role ?? null;
  const writable = role != null && canWrite(role, "projects") && project.archived_at == null;
  const owner = role != null && isOwner(role);

  return (
    <div className="flex flex-col gap-5">
      {writable && <DocumentUploadForm projectId={projectId} />}
      <DocumentsList
        projectId={projectId}
        documents={documents}
        currentUserId={sessionUser?.id ?? null}
        isOwner={owner}
      />
    </div>
  );
}
