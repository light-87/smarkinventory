import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import type { PortalPhase } from "@/lib/portal/types";

const SIDELINE_LABEL: Record<"parallel" | "buffer", string> = {
  parallel: "Parallel",
  buffer: "Buffer",
};

function PhaseDates({ phase }: { phase: PortalPhase }) {
  if (phase.start_date || phase.end_date) {
    return (
      <span className="font-mono text-caption text-smoke">
        {formatDate(phase.start_date)} – {formatDate(phase.end_date)}
      </span>
    );
  }
  if (phase.duration_text) {
    return <span className="text-caption text-smoke">{phase.duration_text}</span>;
  }
  return null;
}

/**
 * Read-only phase timeline (FEATURES §10 / plan/tab-client-portal.md §2):
 * current phase highlighted, done phases checked, parallel/buffer rows
 * styled distinctly (dashed border + label chip), footnote rows rendered
 * below the list as footnotes rather than timeline entries — same estimate-
 * sheet row shape (`row_kind`) as the internal hub.
 */
export function PhaseTimeline({ phases }: { phases: PortalPhase[] }) {
  const rows = phases
    .filter((p) => p.row_kind !== "footnote")
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  const footnotes = phases
    .filter((p) => p.row_kind === "footnote")
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  if (rows.length === 0) {
    return <p className="text-body-sm text-smoke">No timeline has been shared yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {rows.map((phase) => {
          const isActive = phase.status === "active";
          const isDone = phase.status === "done";
          const isSideline = phase.row_kind === "parallel" || phase.row_kind === "buffer";

          return (
            <li
              key={phase.id}
              className={cn(
                "rounded-xl border px-4 py-3",
                isActive ? "border-smark-orange bg-surface-accent" : "border-charcoal bg-surface-panel",
                isSideline && !isActive && "border-dashed",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {isDone && (
                  <span
                    aria-hidden
                    className="flex size-4 flex-none items-center justify-center rounded-full bg-phosphor-green text-[12px] leading-none font-medium text-obsidian"
                  >
                    ✓
                  </span>
                )}
                <span
                  className={cn(
                    "text-[15px] font-medium",
                    isDone ? "text-silver-mist" : "text-snow",
                  )}
                >
                  {phase.name}
                </span>
                {isSideline && (
                  <Chip tone="soft" size="sm">
                    {SIDELINE_LABEL[phase.row_kind as "parallel" | "buffer"]}
                  </Chip>
                )}
                {isActive && (
                  <Chip tone="accent" size="sm">
                    Current
                  </Chip>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5">
                <PhaseDates phase={phase} />
                {phase.notes && <span className="text-caption text-smoke">{phase.notes}</span>}
              </div>
            </li>
          );
        })}
      </ol>

      {footnotes.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border-divider pt-3">
          {footnotes.map((note) => (
            <p key={note.id} className="text-caption text-smoke">
              {note.name}
              {note.notes ? ` — ${note.notes}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
