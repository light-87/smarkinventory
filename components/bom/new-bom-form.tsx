"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { BomTemplateColumn } from "@/types/db";
import { UploadBomPanel } from "./upload-bom-panel";
import { CreateBomGrid } from "./create-bom-grid";

export interface NewBomFormProps {
  projectId: string;
  initialColumns: BomTemplateColumn[];
}

type Mode = "upload" | "create";

/** Switches between "Upload a filled template" and "Create BOM in-app" (R2-19) — same end result, either way. */
export function NewBomForm({ projectId, initialColumns }: NewBomFormProps) {
  const [mode, setMode] = useState<Mode>("upload");

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="New BOM method"
        value={mode}
        onChange={setMode}
        options={[
          { value: "upload", label: "Upload file" },
          { value: "create", label: "Create in-app" },
        ]}
      />
      {mode === "upload" ? (
        <UploadBomPanel projectId={projectId} />
      ) : (
        <CreateBomGrid projectId={projectId} initialColumns={initialColumns} />
      )}
    </div>
  );
}
