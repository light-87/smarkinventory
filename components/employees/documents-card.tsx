"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import type { EmployeeDocumentRow, EmployeeDocType } from "@/types/db";
import { DownloadDocumentButton } from "./download-document-button";

const DOC_TYPE_LABELS: Record<EmployeeDocType, string> = {
  nda: "Signed NDA",
  aadhaar: "Aadhaar card",
  pan_card: "PAN card",
  nda_client: "Client NDA",
  other: "Other",
};

const DOC_TYPE_OPTIONS: EmployeeDocType[] = ["nda", "aadhaar", "pan_card", "nda_client", "other"];

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Settings → My Profile "Documents" card: upload (NDA / Aadhaar / PAN card
 * image / client-labeled NDA / other) via app/api/employees/documents/route.ts
 * (multipart FormData → StoragePort → smark_employee_documents row — real
 * binary transfer, same call as components/expenses/entry-form-drawer.tsx's
 * attachment upload), plus the caller's own uploaded-documents list with a
 * signed-URL download action per row.
 */
export function DocumentsCard({ documents }: { documents: EmployeeDocumentRow[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [docType, setDocType] = useState<EmployeeDocType>("nda");
  const [clientLabel, setClientLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const needsLabel = docType === "nda_client" || docType === "other";

  async function upload() {
    if (!file) return push({ msg: "Choose a file first" });
    if (needsLabel && !clientLabel.trim()) {
      return push({ msg: docType === "nda_client" ? "Client name is required" : "A label is required" });
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("docType", docType);
      if (clientLabel.trim()) formData.set("clientLabel", clientLabel.trim());
      formData.set("displayName", file.name);
      formData.set("file", file);

      const response = await fetch("/api/employees/documents", { method: "POST", body: formData });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (response.ok && result.ok) {
        push({ msg: "Document uploaded" });
        setFile(null);
        setClientLabel("");
        router.refresh();
      } else {
        push({ msg: result.error ?? "Upload failed." });
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card padding="none">
      <CardHeader title="My documents" meta={<span className="text-smoke">{documents.length} uploaded</span>} />
      <CardBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-lg border border-charcoal p-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field htmlFor="doc-type" label="Document type">
              <select
                id="doc-type"
                value={docType}
                onChange={(e) => setDocType(e.target.value as EmployeeDocType)}
                className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none focus:border-smark-orange"
              >
                {DOC_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {DOC_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>
            {needsLabel && (
              <Field htmlFor="doc-label" label={docType === "nda_client" ? "Client name" : "Label"}>
                <Input
                  id="doc-label"
                  value={clientLabel}
                  onChange={(e) => setClientLabel(e.target.value)}
                  placeholder={docType === "nda_client" ? "Acme Corp" : "e.g. Offer letter"}
                />
              </Field>
            )}
          </div>
          <Field label="File">
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-smoke file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-charcoal file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:text-snow"
            />
          </Field>
          <Button onClick={upload} loading={uploading} fullWidth>
            Upload
          </Button>
        </div>

        <div className="flex flex-col gap-2.5">
          {documents.length === 0 && <div className="text-body-sm text-smoke">No documents uploaded yet.</div>}
          {documents.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-charcoal px-3.5 py-2.5">
              <Chip tone="accent" size="sm">
                {DOC_TYPE_LABELS[doc.doc_type]}
              </Chip>
              <span className="min-w-0 flex-1 truncate text-[14px] text-snow">
                {doc.client_label ? `${doc.client_label} — ${doc.display_name}` : doc.display_name}
              </span>
              <span className="flex-none text-caption text-smoke">
                {formatDate(doc.created_at)}
                {doc.size_bytes != null ? ` · ${formatSize(doc.size_bytes)}` : ""}
              </span>
              <DownloadDocumentButton documentId={doc.id} />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
