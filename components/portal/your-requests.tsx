import { Chip, type ChipTone } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { PortalRequest } from "@/lib/portal/types";

/**
 * "Your requests" — the client's own change requests + reported issues with
 * their current status, so they can see what happened to what they raised
 * instead of submitting into a void. Data: `portal_get_requests`
 * (0014_portal_requests.sql) via `getPortalRequests`.
 */

/** Client-facing status label + colour, per kind. Amber = acknowledged/caution, green = resolved, muted = closed-no-action. */
function statusChip(kind: PortalRequest["kind"], status: string): { tone: ChipTone; label: string } {
  if (kind === "change") {
    if (status === "accepted") return { tone: "success", label: "Accepted" };
    if (status === "rejected") return { tone: "default", label: "Not taken up" };
    return { tone: "neutral", label: "Pending review" };
  }
  // issue
  if (status === "confirmed") return { tone: "warn", label: "Confirmed" };
  if (status === "resolved") return { tone: "success", label: "Fixed" };
  if (status === "dismissed") return { tone: "default", label: "Reviewed — no change" };
  return { tone: "neutral", label: "Received" };
}

export function YourRequests({ requests }: { requests: readonly PortalRequest[] }) {
  if (requests.length === 0) {
    return (
      <EmptyState
        tone="subtle"
        title="Nothing raised yet"
        description="Change requests and issues you send will show up here with their status."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {requests.map((r) => {
        const s = statusChip(r.kind, r.status);
        return (
          <li key={r.id} className="flex flex-col gap-1.5 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Chip tone={r.kind === "change" ? "accent" : "warn"} size="sm">
                {r.kind === "change" ? "Change" : "Issue"}
              </Chip>
              <Chip tone={s.tone} size="sm">
                {s.label}
              </Chip>
            </div>
            <p className="text-[14px] break-words text-snow">{r.description}</p>
            {r.task_title && <p className="text-caption break-words text-smoke">on “{r.task_title}”</p>}
          </li>
        );
      })}
    </ul>
  );
}
