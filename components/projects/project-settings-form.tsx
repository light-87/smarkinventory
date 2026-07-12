"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/projects/confirm-dialog";
import { setProjectArchivedAction, updateProjectAction } from "@/lib/pm/actions";

export interface ProjectSettingsFormProps {
  projectId: string;
  name: string;
  client: string | null;
  archivedAt: string | null;
}

/** Owner-only project details editor (rename + client) and archive/restore (Manage tab). */
export function ProjectSettingsForm({ projectId, name, client, archivedAt }: ProjectSettingsFormProps) {
  const router = useRouter();
  const { push } = useToast();
  const archived = archivedAt != null;

  const [nameValue, setNameValue] = useState(name);
  const [clientValue, setClientValue] = useState(client ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, startArchive] = useTransition();

  const dirty = nameValue.trim() !== name || clientValue.trim() !== (client ?? "");

  function save() {
    if (!nameValue.trim()) {
      setSaveError("Project name is required.");
      return;
    }
    setSaveError(null);
    startSave(async () => {
      const result = await updateProjectAction({
        projectId,
        name: nameValue.trim(),
        client: clientValue.trim() || null,
      });
      if (result.ok) {
        push({ msg: "Project updated" });
        router.refresh();
      } else {
        setSaveError(result.error);
      }
    });
  }

  function setArchived(next: boolean) {
    setArchiveError(null);
    startArchive(async () => {
      const result = await setProjectArchivedAction({ projectId, archived: next });
      if (result.ok) {
        setConfirmArchive(false);
        push({ msg: next ? "Project archived" : "Project restored" });
        router.refresh();
      } else {
        setArchiveError(result.error);
      }
    });
  }

  return (
    <>
      <Card className="flex flex-col gap-4">
        <SectionLabel>Project details</SectionLabel>
        <Field label="Project name" htmlFor="project-name" error={saveError ?? undefined}>
          <Input
            id="project-name"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder="e.g. Wing Sensor Module"
            disabled={saving}
          />
        </Field>
        <Field label="Client" htmlFor="project-client" hint="Shown to the client on the portal.">
          <Input
            id="project-client"
            value={clientValue}
            onChange={(e) => setClientValue(e.target.value)}
            placeholder="Client name (optional)"
            disabled={saving}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save changes
          </Button>
          {dirty && !saving && <span className="text-caption text-faint">Unsaved changes</span>}
        </div>

        <div className="mt-2 flex flex-col gap-2 border-t border-charcoal pt-4">
          <SectionLabel>{archived ? "Archived project" : "Archive project"}</SectionLabel>
          <p className="text-caption text-faint">
            {archived
              ? "This project is archived — hidden from active lists, its demand is released, and the client portal is suspended. Restore it to make it active again."
              : "Archiving hides the project from active lists, releases its cart demand and suspends the client portal. Nothing is deleted — it's reversible."}
          </p>
          {archived ? (
            <Button size="sm" variant="outline" onClick={() => setArchived(false)} loading={archiving} className="self-start">
              Restore project
            </Button>
          ) : (
            <Button
              size="sm"
              variant="accent-outline"
              onClick={() => {
                setArchiveError(null);
                setConfirmArchive(true);
              }}
              className="self-start"
            >
              Archive project
            </Button>
          )}
          {archiveError && <p className="text-caption text-smark-orange-soft">{archiveError}</p>}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmArchive}
        title={`Archive "${name}"?`}
        description={
          <>
            <p>
              This hides the project from active lists, releases its cross-project cart demand, and suspends the client
              portal link. Tasks, BOMs, runs and history are kept — you can restore it anytime.
            </p>
            {archiveError && <p className="mt-2 text-smark-orange">{archiveError}</p>}
          </>
        }
        confirmLabel="Archive project"
        destructive
        loading={archiving}
        onConfirm={() => setArchived(true)}
        onCancel={() => {
          if (!archiving) setConfirmArchive(false);
        }}
      />
    </>
  );
}
