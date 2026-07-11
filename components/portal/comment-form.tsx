"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitPortalComment } from "@/lib/portal/actions";

/**
 * Client input → `portal_add_comment` (rate-limited, see
 * supabase/migrations/0006_portal_fns.sql). On success, `router.refresh()`
 * re-fetches the server-rendered feed so the client's own comment shows up
 * immediately in `UpdatesFeed` above (the RPC marks portal comments
 * `shared_to_portal = true` for exactly this reason).
 */
export function CommentForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await submitPortalComment({ token, authorName: name, body });
      if (!result.ok) {
        setError(result.error ?? "Could not post your message — please try again.");
        return;
      }
      setBody("");
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label="Your name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Ramesh"
          maxLength={200}
          required
          disabled={pending}
          uiSize="lg"
        />
      </Field>
      <Field label="Message" error={error}>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Ask a question or share feedback…"
          maxLength={2000}
          required
          disabled={pending}
          invalid={Boolean(error)}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" loading={pending} disabled={pending}>
          Send
        </Button>
        {success && <span className="text-body-sm text-phosphor-green">Sent ✓ — thank you!</span>}
      </div>
    </form>
  );
}
