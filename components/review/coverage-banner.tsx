"use client";

/**
 * components/review/coverage-banner.tsx — the incomplete-run guardrail banner on
 * Order Review. A desktop run is "adequate" only when every line has a real
 * result or a genuine skip (lib/desktop/sync.ts `ingestDesktopResults`); until
 * then the BOM stays unsourced and its cart CTAs are gated. This banner explains
 * the gap and lets an owner/employee either re-run the desktop agent (which
 * auto-retries the empty lines) or "Accept anyway" to force it sourced.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { acceptRunCoverageAction } from "@/app/(app)/projects/[projectId]/runs/[runId]/actions";
import { formatNumber } from "@/lib/format";
import type { RunCoverage } from "@/lib/runs/types";

export interface CoverageBannerProps {
  coverage: RunCoverage;
  bomId: string;
  writable: boolean;
  /** Whether the BOM is already sourced (owner already accepted, or a later run covered it). */
  sourced: boolean;
}

export function CoverageBanner({ coverage, bomId, writable, sourced }: CoverageBannerProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [accepting, startAccept] = useTransition();

  function accept() {
    setError(null);
    startAccept(async () => {
      const result = await acceptRunCoverageAction({ bomId });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card padding="lg" className="border-warn/60">
      <div className="flex flex-wrap items-center gap-2.5 text-[15px] text-snow">
        <Chip tone="warn">incomplete</Chip>
        <span>
          Only <span className="font-mono text-silver-mist">{formatNumber(coverage.covered)}</span> of{" "}
          <span className="font-mono text-silver-mist">{formatNumber(coverage.total)}</span> lines were sourced
          {coverage.skipped > 0 ? ` (${formatNumber(coverage.skipped)} skipped)` : ""} —{" "}
          <span className="text-warn">{formatNumber(coverage.empty)}</span>{" "}
          {coverage.empty === 1 ? "line has" : "lines have"} no results.{" "}
          {sourced
            ? "Accepted despite the gaps — this BOM is orderable."
            : "This BOM stays unsourced until the gaps are filled. Re-run the desktop agent — it automatically retries the lines with no results — or accept it as-is."}
        </span>
        {writable && !sourced && (
          <Button size="sm" variant="outline" onClick={accept} loading={accepting}>
            Accept anyway
          </Button>
        )}
      </div>
      {error && <div className="mt-2 text-caption text-smark-orange-soft">{error}</div>}
    </Card>
  );
}
