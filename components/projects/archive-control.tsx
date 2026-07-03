"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { archiveProjectAction, unarchiveProjectAction } from "@/lib/projects/actions";
import { ConfirmDialog } from "./confirm-dialog";

export interface ArchiveControlProps {
  projectId: string;
  archived: boolean;
}

/**
 * Archive/unarchive (owner-only, R2-32 — approved I-02 "give a warning"):
 * archive shows a warning dialog spelling out consequences before it takes
 * effect; unarchive reverses it directly (no destructive side effects to warn about).
 */
export function ArchiveControl({ projectId, archived }: ArchiveControlProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function archive() {
    startTransition(async () => {
      try {
        await archiveProjectAction(projectId);
        setConfirmOpen(false);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't archive the project." });
      }
    });
  }

  function unarchive() {
    startTransition(async () => {
      try {
        await unarchiveProjectAction(projectId);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't unarchive the project." });
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel>{archived ? "Archived" : "Archive this project"}</SectionLabel>
      {archived ? (
        <>
          <p className="text-caption text-smoke">
            Hidden from active lists and pickers; cart demand released; portal link suspended.
          </p>
          <Button size="sm" variant="outline" onClick={unarchive} loading={isPending} className="self-start">
            Unarchive
          </Button>
        </>
      ) : (
        <>
          <p className="text-caption text-smoke">Closes the job out — see the warning before confirming.</p>
          <Button
            size="sm"
            variant="accent-outline"
            onClick={() => setConfirmOpen(true)}
            className="self-start"
          >
            Archive project
          </Button>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Archive this project?"
        description={
          <>
            This releases all cart demand from this project&rsquo;s BOMs, freezes its activity and
            tasks, hides it from active lists and pickers, and its client-portal link stops
            resolving. You can unarchive later to reverse all of this.
          </>
        }
        confirmLabel="Archive"
        destructive
        loading={isPending}
        onConfirm={archive}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  );
}
