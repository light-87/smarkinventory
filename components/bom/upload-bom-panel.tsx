"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { uploadBomAction } from "@/app/(app)/projects/[projectId]/boms/actions";

export interface UploadBomPanelProps {
  projectId: string;
}

/** "Upload BOM" — name required + file, parsed via lib/import/bom.ts + lib/bom/parse-upload.ts. */
export function UploadBomPanel({ projectId }: UploadBomPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [priorityNotes, setPriorityNotes] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name this BOM.");
      return;
    }
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a .xlsx file to upload.");
      return;
    }

    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("name", trimmedName);
    formData.set("priorityNotes", priorityNotes.trim());
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadBomAction(formData);
      if (result.ok) {
        router.push(`/projects/${projectId}/boms/${result.bomId}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Upload a filled template</SectionLabel>
          <a
            href="/api/boms/template"
            className="text-[14px] text-smoke transition-colors hover:text-snow"
            download
          >
            Download template ↓
          </a>
        </div>

        <Field label={<>Name <span className="text-smark-orange">*</span></>} hint="Unique within this project — e.g. &ldquo;Mainboard v1.2&rdquo;">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mainboard v1.2" />
        </Field>

        <Field label="Overall priorities" hint="Optional plain-English notes carried onto the ordering workspace">
          <textarea
            value={priorityNotes}
            onChange={(e) => setPriorityNotes(e.target.value)}
            rows={3}
            placeholder="Prefer LCSC where available, DigiKey for anything NRND…"
            className="w-full resize-y rounded-lg border border-charcoal bg-surface-well p-3 text-sm text-snow outline-none focus:border-smark-orange"
          />
        </Field>

        <div
          className="cursor-pointer rounded-2xl border-[1.5px] border-dashed border-slate bg-surface-panel px-6 py-10 text-center transition-colors hover:border-smark-orange"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <div className="text-[16px] text-snow">{fileName ?? "Drop your filled template here"}</div>
          <div className="mt-1.5 text-[14px] text-smoke">{fileName ? "Tap to choose a different file" : ".xlsx only"}</div>
        </div>

        {error && <div className="text-caption text-smark-orange-soft">{error}</div>}

        <div>
          <Button size="lg" onClick={submit} loading={isPending}>
            Upload &amp; reconcile
          </Button>
        </div>
      </div>
    </Card>
  );
}
