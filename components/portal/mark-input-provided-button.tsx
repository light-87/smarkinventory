"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markPortalInputProvided } from "@/lib/portal/actions";

/**
 * Per-task "I've provided this" action, rendered only while a task's status
 * is `awaiting_client_input` (`portal_get_pm`). Closes the open
 * `smark_task_holds` row via `portal_mark_input_provided`; on success the
 * `router.refresh()` re-fetches the task list so the status/action updates
 * immediately (mirrors `CommentForm`'s refresh pattern).
 */
export function MarkInputProvidedButton({ token, taskId }: { token: string; taskId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await markPortalInputProvided({ token, taskId });
      if (!result.ok) {
        setError(result.error ?? "Could not update this task — please try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="accent-outline" size="sm" loading={pending} disabled={pending} onClick={handleClick}>
        I&apos;ve provided this
      </Button>
      {error && <p className="text-caption text-smark-orange-soft">{error}</p>}
    </div>
  );
}
