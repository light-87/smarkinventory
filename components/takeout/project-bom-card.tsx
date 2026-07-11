"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import type { PickableProject } from "@/lib/takeout/queries";
import { NativeSelect } from "./native-select";

export interface ProjectBomCardProps {
  projects: readonly PickableProject[];
  onPick: (bomId: string) => void;
  loading: boolean;
}

/** Empty-state panel #2 — "pick a project BOM" [R2-03 ripple] (plan/tab-bulk-pick.md §5). */
export function ProjectBomCard({ projects, onPick, loading }: ProjectBomCardProps) {
  const [projectId, setProjectId] = useState("");
  const [bomId, setBomId] = useState("");
  const boms = projects.find((p) => p.id === projectId)?.boms ?? [];

  return (
    <Card padding="lg" className="flex flex-1 flex-col">
      <div className="text-[16px] text-snow">Pick a project BOM</div>
      <div className="mt-1 text-caption text-smoke">
        Reuses an uploaded/created BOM&apos;s lines — its build quantity prefills the ×N banner below.
      </div>

      {projects.length === 0 ? (
        <div className="mt-4 text-[14px] text-smoke">No non-archived project has a BOM yet.</div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Project">
            <NativeSelect
              aria-label="Project"
              placeholder="Choose a project…"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setBomId("");
              }}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>

          {projectId && (
            <Field label="BOM">
              <NativeSelect
                aria-label="BOM"
                placeholder="Choose a BOM…"
                value={bomId}
                onChange={(e) => setBomId(e.target.value)}
                options={boms.map((b) => ({ value: b.id, label: `${b.name} · ${b.lineCount} lines · ×${b.buildQty}` }))}
              />
            </Field>
          )}

          <Button disabled={!bomId} loading={loading} onClick={() => onPick(bomId)} className="self-start">
            Load this BOM
          </Button>
        </div>
      )}
    </Card>
  );
}
