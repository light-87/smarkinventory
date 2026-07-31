"use client";

/**
 * hooks/use-action-runner.ts — the standard way a Client Component calls a
 * Project-Management Server Action.
 *
 * It exists because every PM surface had hand-rolled a slightly different
 * version of the same block, and each one was missing something:
 *
 *  - No try/catch. If the action rejected — a thrown ZodError, an expired
 *    session, the proxy answering an action POST with a login redirect — the
 *    rejection escaped the transition and took the whole page down.
 *  - No success feedback. On `ok` they called `router.refresh()` and nothing
 *    else, so a save that worked looked identical to one that did nothing.
 *  - No handling for "your session is gone", which needs a trip to /login,
 *    not a toast the user can't act on.
 *
 * `run()` covers all three and never throws.
 */

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/** The shape every PM action resolves with. `code` is set by lib/pm/action-error.ts. */
export interface ActionOutcome {
  ok: boolean;
  error?: string;
  code?: string;
  /** Non-fatal note on an otherwise successful action (e.g. "saved, but the email didn't send"). */
  warning?: string;
}

export interface RunOptions {
  /** Toast shown when the action succeeds. Skip only when the UI change is obvious on its own. */
  success?: string;
  /** Runs before the refresh — clear inputs, close a form. */
  onDone?: () => void;
}

export function useActionRunner() {
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();

  function run<T extends ActionOutcome>(action: () => Promise<T>, options: RunOptions = {}): void {
    startTransition(async () => {
      let result: T;
      try {
        result = await action();
      } catch (error) {
        // The action itself never throws any more (guardAction), so getting
        // here means the request didn't complete: offline, a dropped
        // connection, or a session so stale the edge answered with a redirect
        // instead of an action response.
        console.error("[pm] action request failed:", error);
        push({ msg: "Couldn't reach the server — you may have been logged out. Reload the page and try again." });
        return;
      }

      if (result.ok) {
        options.onDone?.();
        if (result.warning) push({ msg: result.warning });
        else if (options.success) push({ msg: options.success });
        router.refresh();
        return;
      }

      push({ msg: result.error ?? "Something went wrong." });
      if (result.code === "auth") {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });
  }

  return { run, isPending };
}
