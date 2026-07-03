"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Documents tab — upload via StoragePort, required display name ("store everything with its name", R2-16). */
export function DocumentUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      push({ msg: "Choose a file" });
      return;
    }
    if (!displayName.trim()) {
      push({ msg: "A display name is required" });
      return;
    }

    const form = new FormData();
    form.set("projectId", projectId);
    form.set("displayName", displayName.trim());
    if (note.trim()) form.set("note", note.trim());
    form.set("file", file);

    startTransition(async () => {
      try {
        const res = await fetch("/api/projects/documents", { method: "POST", body: form });
        const body: { ok?: boolean; error?: string } = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error ?? "Upload failed.");
        push({ msg: `Uploaded "${displayName.trim()}"` });
        setDisplayName("");
        setNote("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Upload failed." });
      }
    });
  }

  return (
    <Card tone="panel" className="flex flex-col gap-3">
      <SectionLabel>Upload document</SectionLabel>
      <Field label="Display name">
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Enclosure drawing rev B"
        />
      </Field>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <input
        ref={fileRef}
        type="file"
        className="text-[13px] text-smoke file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-charcoal file:bg-transparent file:px-3.5 file:py-1.5 file:text-[13px] file:text-snow"
      />
      <Button size="sm" onClick={submit} loading={isPending} className="self-start">
        Upload
      </Button>
    </Card>
  );
}
