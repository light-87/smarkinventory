"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import type { ProjectDocumentRow } from "@/types/db";
import { deleteProjectDocumentAction } from "@/lib/pm/actions";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DocumentsListProps {
  projectId: string;
  documents: readonly ProjectDocumentRow[];
  currentUserId: string | null;
  isOwner: boolean;
}

/** Documents tab list: name · size · uploaded at · download · delete (owner or uploader). */
export function DocumentsList({ projectId, documents, currentUserId, isOwner }: DocumentsListProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    startTransition(async () => {
      const result = await deleteProjectDocumentAction(projectId, id);
      if (result.ok) {
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  if (documents.length === 0) {
    return (
      <Card>
        <SectionLabel>Documents</SectionLabel>
        <p className="mt-2 text-caption text-smoke">Nothing uploaded yet.</p>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <div className="border-b border-border-divider px-5 py-4">
        <SectionLabel>Documents</SectionLabel>
      </div>
      <ul className="divide-y divide-border-hairline">
        {documents.map((doc) => {
          const canDelete = isOwner || doc.uploaded_by === currentUserId;
          return (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] text-snow">{doc.display_name}</div>
                <div className="mt-0.5 text-caption text-smoke">
                  {formatBytes(doc.size_bytes)} · {formatDate(doc.created_at)}
                </div>
              </div>
              <div className="flex flex-none items-center gap-3 text-[15px]">
                <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-smark-orange hover:underline">
                  Download
                </a>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(doc.id, doc.display_name)}
                    disabled={isPending}
                    className="min-h-11 min-w-11 cursor-pointer text-smoke hover:text-smark-orange disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
