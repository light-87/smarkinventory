"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requestPortalChange } from "@/lib/portal/actions";

/**
 * Project-level "Request a change" form → `portal_request_change`. Same
 * shape as `CommentForm` (uncontrolled success/error/pending state,
 * `router.refresh()` on success) but scoped to the whole project rather
 * than a single task, so it lives in its own card on the page rather than
 * per task-list item.
 */
export function ChangeRequestForm({ token, projectId }: { token: string; projectId: string }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await requestPortalChange({ token, projectId, description });
      if (!result.ok) {
        setError(result.error ?? "Could not send your request — please try again.");
        return;
      }
      setDescription("");
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Describe the change you'd like…"
        maxLength={2000}
        required
        disabled={pending}
        rows={3}
        className="w-full resize-none rounded-lg border border-charcoal bg-surface-well px-3.5 py-2.5 text-sm text-snow outline-none transition-colors placeholder:text-smoke focus:border-smark-orange disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error && <p className="text-caption text-smark-orange-soft">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" loading={pending} disabled={pending}>
          Send request
        </Button>
        {success && <span className="text-body-sm text-phosphor-green">Sent — thank you!</span>}
      </div>
    </form>
  );
}
