"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import type { ActivityType } from "@/types/db";
import type { AppUserOption } from "@/lib/projects/queries";
import { addActivityAction } from "@/lib/projects/notes-actions";

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "meeting", label: "Meeting" },
  { value: "change", label: "Change" },
  { value: "task", label: "Task" },
];

export interface NewActivityFormProps {
  projectId: string;
  members: readonly AppUserOption[];
}

/** Notes & tasks — new entry composer (R2-06): Note/Meeting/Change/Task, task fields, opt-in portal share. */
export function NewActivityForm({ projectId, members }: NewActivityFormProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ActivityType>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [shareToPortal, setShareToPortal] = useState(false);

  function submit() {
    if (!title.trim() && !body.trim()) {
      push({ msg: "Add a title or a note" });
      return;
    }
    startTransition(async () => {
      try {
        await addActivityAction({
          projectId,
          type,
          title: title.trim() || null,
          body: body.trim() || null,
          taskAssignee: type === "task" ? assignee || null : null,
          taskDue: type === "task" ? due || null : null,
          sharedToPortal: shareToPortal,
        });
        setTitle("");
        setBody("");
        setAssignee("");
        setDue("");
        setShareToPortal(false);
        router.refresh();
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't add that entry." });
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel>New entry</SectionLabel>
      <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={setType} aria-label="Entry type" />
      <Field label="Title (optional)">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={type === "task" ? "Description" : "Note"}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-lg border border-charcoal bg-surface-well px-3.5 py-2.5 text-sm text-snow outline-none placeholder:text-smoke focus:border-smark-orange"
        />
      </Field>
      {type === "task" && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="Assignee">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-10 rounded-lg border border-charcoal bg-surface-well px-3 text-sm text-snow outline-none focus:border-smark-orange"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name ?? m.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
      )}
      <label className="flex items-center gap-2 text-caption text-smoke">
        <input type="checkbox" checked={shareToPortal} onChange={(e) => setShareToPortal(e.target.checked)} />
        Share to client portal
      </label>
      <Button size="sm" onClick={submit} loading={isPending} className="self-start">
        Add entry
      </Button>
    </Card>
  );
}
