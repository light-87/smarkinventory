"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createProjectAction } from "@/lib/projects/actions";

/** Projects-list "New project" card: name required, client optional (plan/tab-orders-projects.md). */
export function NewProjectForm() {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      push({ msg: "Project name is required" });
      return;
    }
    startTransition(async () => {
      try {
        const result = await createProjectAction({ name: trimmed, client: client.trim() || null });
        router.push(`/projects/${result.id}`);
      } catch (error) {
        push({ msg: error instanceof Error ? error.message : "Couldn't create the project." });
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
        <Input
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder="Acme Robotics"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>
      <Button className="mt-auto" onClick={submit} loading={isPending} fullWidth>
        Create
      </Button>
    </Card>
  );
}
