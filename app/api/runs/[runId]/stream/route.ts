/**
 * app/api/runs/[runId]/stream/route.ts — live SSE feed for the Agent Run
 * console (plan/tab-agent-run.md, hooks/use-run-stream.ts). Polls
 * `lib/runs/queries.ts`'s `getRunSnapshot` (service-role — `smark_order_jobs`/
 * `smark_agent_results` are service-role-only RLS, migration 0004) on an
 * interval and pushes each snapshot as a named `snapshot` SSE event; closes
 * the stream once the run reaches a terminal status (`review`/`done`/
 * `failed`) so the client never has to guess when to stop listening.
 *
 * Two distinct error events, matched 1:1 with how hooks/use-run-stream.ts
 * reacts to them (report finding #10 — the two sides used to disagree, with
 * every error read as fatal): `stream-warning` for a transient snapshot
 * read failure (the run is still progressing; the client keeps its
 * connection open and the next tick can recover) vs. `stream-error` for a
 * definitive failure (the run itself no longer exists; the client closes).
 *
 * No Postgres Realtime wiring here — the worker itself is poll-driven
 * (worker/index.ts's own `POLL_INTERVAL_MS`), so a short-interval poll on
 * this side is consistent with the rest of the pipeline rather than a
 * mismatched second delivery mechanism.
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getRunSnapshot } from "@/lib/runs/queries";
import { TABLES } from "@/types/db";

export const dynamic = "force-dynamic";

const POLL_MS = 1500;
const TERMINAL_STATUSES = new Set(["review", "done", "failed"]);

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in.", { status: 401 });

  // Cheap existence probe under the caller's own RLS — `smark_agent_runs`
  // has real owner/employee/accountant policies (migration 0004), so this
  // also acts as the access check before the service-role polling loop below.
  const { data: run } = await supabase.from(TABLES.agent_runs).select("id").eq("id", runId).maybeSingle();
  if (!run) return new Response("That run no longer exists.", { status: 404 });

  const service = createServiceClient();
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      async function tick() {
        if (closed) return;
        try {
          const snapshot = await getRunSnapshot(service, runId);
          if (!snapshot) {
            // Fatal — the run itself is gone, not coming back on a later poll.
            send("stream-error", { message: "That run no longer exists." });
            closed = true;
            controller.close();
            return;
          }
          send("snapshot", snapshot);
          if (TERMINAL_STATUSES.has(snapshot.status)) {
            closed = true;
            controller.close();
            return;
          }
        } catch (error) {
          // Transient — a DB hiccup mid-poll while the run is still very much
          // alive. The client (hooks/use-run-stream.ts) used to treat ANY
          // `stream-error` as definitive and close its EventSource, silently
          // killing all live updates until a manual refresh even though the
          // server was about to recover on the next tick (report finding
          // #10). Named distinctly so the two sides can't disagree again:
          // `stream-warning` never closes the connection on either side.
          send("stream-warning", { message: error instanceof Error ? error.message : "Stream error." });
        }
        if (!closed) timer = setTimeout(tick, POLL_MS);
      }

      void tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
