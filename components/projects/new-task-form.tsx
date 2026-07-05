"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createTaskAction } from "@/lib/pm/actions";
import type { EngineerOption } from "@/lib/pm/queries";

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

  function toggleEngineer(userId: string, checked: boolean) {
    setHoursByUser((prev) => {
      const next = { ...prev };
      if (checked) next[userId] = next[userId] ?? "1";
      else delete next[userId];
      return next;
    });
  }

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

      {engineers.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Assign engineers</SectionLabel>
          {engineers.map((eng) => {
            const checked = eng.id in hoursByUser;
            return (
              <div key={eng.id} className="flex items-center gap-3">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 text-[13px] text-snow select-none">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleEngineer(eng.id, e.target.checked)}
                    className="size-[18px] flex-none accent-smark-orange"
                  />
                  {eng.displayName ?? eng.username}
                </label>
                {checked && (
                  <Input
                    uiSize="sm"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={hoursByUser[eng.id]}
                    onChange={(e) => setHoursByUser((prev) => ({ ...prev, [eng.id]: e.target.value }))}
                    className="w-24"
                    aria-label={`Estimated hours for ${eng.displayName ?? eng.username}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

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
