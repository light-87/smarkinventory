"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createProjectAction } from "@/lib/pm/actions";

/** Projects-list "New project" card — name required, client + notes optional, hours-visibility toggle. */
export function NewProjectForm() {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [notes, setNotes] = useState("");
  const [showTimeToClient, setShowTimeToClient] = useState(false);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      push({ msg: "Project name is required" });
      return;
    }
    startTransition(async () => {
      const result = await createProjectAction({
        name: trimmed,
        client: client.trim() || null,
        notes: notes.trim() || null,
        showTimeToClient,
      });
      if (result.ok) {
        router.push(`/projects/${result.id}`);
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card tone="panel" className="flex h-full flex-col gap-3 border-dashed">
      <SectionLabel>New project</SectionLabel>
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mainboard rev C"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>
      <Field label="Client (optional)">
        <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Acme Robotics" />
      </Field>
      <Field label="Notes (optional)">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal context" />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] text-silver-mist select-none">
        <input
          type="checkbox"
          checked={showTimeToClient}
          onChange={(e) => setShowTimeToClient(e.target.checked)}
          className="size-[18px] flex-none accent-smark-orange"
        />
        Share hours with client portal
      </label>
      <Button className="mt-auto" onClick={submit} loading={isPending} fullWidth>
        Create
      </Button>
    </Card>
  );
}
