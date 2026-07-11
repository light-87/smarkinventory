"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reportPortalBug } from "@/lib/portal/actions";

/**
 * Per-task "Report an issue" form, rendered only for a `submitted` task
 * (`portal_get_pm`'s status; the RPC itself re-checks server-side and raises
 * if the task moved on). Collapsed behind a button by default so a task list
 * with several submitted tasks doesn't show N open textareas at once.
 */
export function ReportBugForm({ token, taskId }: { token: string; taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await reportPortalBug({ token, taskId, description });
      if (!result.ok) {
        setError(result.error ?? "Could not send your report — please try again.");
        return;
      }
      setDescription("");
      setSuccess(true);
      setOpen(false);
      router.refresh();
    });
  }

  if (success) {
    return <p className="text-body-sm text-phosphor-green">Sent ✓ — Smark has been notified.</p>;
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Report an issue
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="What went wrong?"
        maxLength={2000}
        required
        disabled={pending}
        autoFocus
        invalid={Boolean(error)}
      />
      {error && <p className="text-caption text-smark-orange-soft">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={pending}>
          Send
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
