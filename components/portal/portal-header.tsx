import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/format";
import { projectStatusLabel } from "@/lib/portal/phase-math";
import type { PortalProjectPayload } from "@/lib/portal/types";

export interface PortalHeaderProps {
  project: PortalProjectPayload;
  /** Last phase end date (lib/portal/phase-math.ts `lastPhaseEndDate`), falling back to `est_delivery_date`. */
  estDelivery: string | null;
}

/**
 * Minimal Smark-branded chrome for `/p/[token]` — deliberately NOT the app
 * shell (no rail/header/avatar menu; this route sits outside `app/(app)/`).
 * SMARK mark + "Client Portal", project name, status + est-delivery chips.
 */
export function PortalHeader({ project, estDelivery }: PortalHeaderProps) {
  return (
    <header className="flex flex-col gap-4 rounded-2xl border border-smark-orange/20 bg-gradient-to-br from-surface-accent to-surface p-6">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset (dark+orange mark, reads on white); no next/image benefit */}
        <img src="/brand/smark-mark.svg" alt="Smark" className="h-6 w-auto" />
        <span className="text-caption font-medium tracking-[0.04em] text-smark-orange uppercase">Client Portal</span>
      </div>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-heading-sm leading-tight font-medium text-snow">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={project.status === "completed" ? "success" : "neutral"} size="md">
            {projectStatusLabel(project.status)}
          </Chip>
          {estDelivery && (
            <Chip tone="default" size="md" mono>
              Est. delivery {formatDate(estDelivery)}
            </Chip>
          )}
        </div>
      </div>
    </header>
  );
}
