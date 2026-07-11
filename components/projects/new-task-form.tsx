"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createTaskAction } from "@/lib/pm/actions";
import type { EngineerOption } from "@/lib/pm/queries";
import { EngineerHoursMatrix } from "./engineer-hours-matrix";

export interface NewTaskFormProps {
  projectId: string;
  engineers: readonly EngineerOption[];
}

/** Owner "Add task" card: title, description, per-engineer estimated hours. */
export function NewTaskForm({ projectId, engineers }: NewTaskFormProps) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hoursByUser, setHoursByUser] = useState<Record<string, string>>({});

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      push({ msg: "Task title is required" });
      return;
    }
    const assignees = Object.entries(hoursByUser).map(([userId, hours]) => ({
      userId,
      estimatedHours: Number(hours) || 0,
    }));
    if (assignees.some((a) => a.estimatedHours <= 0)) {
      push({ msg: "Estimated hours must be greater than 0 for every assigned engineer" });
      return;
    }

    startTransition(async () => {
      const result = await createTaskAction({
        projectId,
        title: trimmed,
        description: description.trim() || null,
        assignees,
      });
      if (result.ok) {
        setTitle("");
        setDescription("");
        setHoursByUser({});
        setOpen(false);
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        + Add task
      </Button>
    );
  }

  return (
    <Card tone="panel" className="flex flex-col gap-3 border-dashed">
      <SectionLabel>New task</SectionLabel>
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wire the enclosure fans" />
      </Field>
      <Field label="Description (optional)">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <EngineerHoursMatrix engineers={engineers} value={hoursByUser} onChange={setHoursByUser} />

      <div className="flex gap-2">
        <Button onClick={submit} loading={isPending}>
          Create task
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
