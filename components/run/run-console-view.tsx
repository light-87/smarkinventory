"use client";

/**
 * components/run/run-console-view.tsx — the Agent Run console
 * (plan/tab-agent-run.md, prototype `isOrderRun`) that
 * app/(app)/projects/[projectId]/runs/[runId]/page.tsx renders. Live
 * comparison-row streaming via hooks/use-run-stream.ts (SSE, falls back to
 * the server-rendered snapshot for an already-settled run).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useRunStream } from "@/hooks/use-run-stream";
import { formatINR, formatNumber, formatRelativeTime } from "@/lib/format";
import type { InStockLane, RunConsoleData, SourcingLane } from "@/lib/runs/types";

export interface RunConsoleViewProps {
  projectId: string;
  data: RunConsoleData;
}

const STATUS_TONE: Record<string, "accent" | "success" | "neutral" | "default"> = {
  planning: "neutral",
  running: "accent",
  review: "success",
  done: "success",
  failed: "default",
};

function jobStatusChip(status: SourcingLane["jobStatus"]) {
  switch (status) {
    case "done":
      return { label: "Done", tone: "success" as const, spin: false };
    case "failed":
      return { label: "Failed", tone: "default" as const, spin: false };
    case "claimed":
      return { label: "Searching…", tone: "accent" as const, spin: true };
    case "queued":
      return { label: "Queued", tone: "neutral" as const, spin: false };
    default:
      return { label: "Not dispatched", tone: "default" as const, spin: false };
  }
}

function matchGlyph(ok: boolean | "exact" | "approx" | "none") {
  if (ok === true || ok === "exact") return { glyph: "✓", className: "text-phosphor-green" };
  if (ok === "approx") return { glyph: "~", className: "text-smark-orange" };
  return { glyph: "✗", className: "text-smoke" };
}

function InStockRow({ lane }: { lane: InStockLane }) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-charcoal bg-surface px-3.5 py-2">
      <span className="w-20 flex-none font-mono text-[13px] text-snow">{lane.ref}</span>
      <span className="flex-1 truncate text-[13px] text-smoke">{lane.value}</span>
      <span className="flex-none text-caption text-phosphor-green">✓ {lane.flag}</span>
    </div>
  );
}

function SourcingLaneCard({ lane }: { lane: SourcingLane }) {
  const status = jobStatusChip(lane.jobStatus);
  const recommended = lane.rows.find((r) => r.isRecommended) ?? lane.rows[0] ?? null;

  return (
    <Card padding="md" className={lane.rows.some((r) => r.isRecommended) ? "border-smark-orange/50" : undefined}>
      <div className="mb-3 flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="font-mono text-[13px] text-snow">{lane.ref}</div>
          <div className="mt-0.5 truncate text-caption text-smoke">{lane.value}</div>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {status.spin && (
            <span
              aria-hidden
              className="size-[11px] animate-spin rounded-full border-[1.5px] border-smark-orange border-t-transparent"
            />
          )}
          <span className={`font-mono text-caption ${status.tone === "accent" ? "text-smark-orange" : status.tone === "success" ? "text-phosphor-green" : "text-smoke"}`}>
            {status.label}
          </span>
        </div>
      </div>

      {lane.aiSkipReason ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-smark-orange bg-surface-accent-hover px-3.5 py-3">
          <span className="text-sm text-smark-orange">✓</span>
          <span className="text-[13px] text-snow">{lane.aiSkipReason}</span>
        </div>
      ) : lane.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse">
            <thead>
              <tr>
                {["Site", "Price", "Stock", "MPN", "Pkg", "Link"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-2 py-1 text-[10px] tracking-[0.04em] text-graphite uppercase ${i === 1 ? "text-right" : i >= 3 ? "text-center" : "text-left"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lane.rows.map((row) => {
                const mpn = matchGlyph(row.mpnMatch);
                const pkg = matchGlyph(row.packageMatch);
                return (
                  <tr key={row.resultId} className={row.isRecommended ? "bg-surface-accent-hover" : undefined}>
                    <td className="border-t border-border-hairline px-2 py-1.5 font-mono text-[12px] whitespace-nowrap text-snow">
                      {row.distributorName}
                      {row.isRecommended && (
                        <Chip tone="accent" size="sm" className="ml-1.5">
                          Recommended
                        </Chip>
                      )}
                    </td>
                    <td className="border-t border-border-hairline px-2 py-1.5 text-right font-mono text-[12px] text-snow">{formatINR(row.price)}</td>
                    <td className="border-t border-border-hairline px-2 py-1.5 text-[12px] text-smoke">{formatNumber(row.stockQty)}</td>
                    <td className={`border-t border-border-hairline px-2 py-1.5 text-center text-[13px] ${mpn.className}`}>{mpn.glyph}</td>
                    <td className={`border-t border-border-hairline px-2 py-1.5 text-center text-[13px] ${pkg.className}`}>{pkg.glyph}</td>
                    <td className="border-t border-border-hairline px-2 py-1.5 text-right">
                      {row.orderLink ? (
                        <a href={row.orderLink} target="_blank" rel="noreferrer" className="text-[12px] text-smark-orange-hover hover:underline">
                          Open ↗
                        </a>
                      ) : (
                        <span className="text-[12px] text-graphite">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : lane.jobStatus === "failed" || lane.jobStatus === "done" ? (
        // "done" with zero rows = the agent searched the ENTIRE ladder
        // (incl. the not-found fallback beyond depth) and found nothing.
        <div className="text-[13px] text-smoke">No listings found across any site in the sequence.</div>
      ) : (
        <div className="text-[13px] text-smoke">Waiting for results…</div>
      )}

      {recommended && !lane.aiSkipReason && (
        <div className="mt-3 border-t border-border-hairline pt-3 text-[13px] leading-[1.5] text-silver-mist">
          <span className="text-smark-orange">AI ·</span> {recommended.why}
        </div>
      )}
    </Card>
  );
}

export function RunConsoleView({ projectId, data }: RunConsoleViewProps) {
  const router = useRouter();
  const initialSnapshot = {
    status: data.run.status,
    narration: data.run.narration,
    doneCount: data.doneCount,
    totalCount: data.totalCount,
    estCost: data.run.estCost,
    actualCost: data.run.actualCost,
    sourcingLanes: data.sourcingLanes,
  };
  const { snapshot, isTerminal, error } = useRunStream(data.run.id, initialSnapshot);

  const live = snapshot ?? initialSnapshot;
  const pct = live.totalCount > 0 ? Math.round((live.doneCount / live.totalCount) * 100) : 100;
  const tone = STATUS_TONE[live.status] ?? "default";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
      <div>
        <div className="text-caption text-smoke">
          <Link href={`/projects/${projectId}/boms/${data.bom.id}`} className="text-smoke hover:text-snow">
            ← {data.project.name}
            {data.project.client ? ` · ${data.project.client}` : ""}
          </Link>
        </div>
        <h1 className="mt-1 text-xl font-semibold text-snow">{data.bom.name}</h1>
      </div>

      <Card padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px] flex-1">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex size-[22px] flex-none items-center justify-center rounded-md border border-smark-orange bg-surface-accent-hover text-xs text-smark-orange">
                ◆
              </span>
              <span className="text-[15px] text-snow">Master agent</span>
              <Chip tone={tone} size="sm">
                {live.status}
              </Chip>
            </div>
            <div className="font-mono text-[13px] leading-[1.5] text-silver-mist">
              {live.narration ?? "Waiting for the plan…"}
            </div>
          </div>
          <div className="flex flex-none items-center gap-6">
            <div className="text-right">
              <div className="font-mono text-xl text-snow">
                {formatNumber(live.doneCount)}/{formatNumber(live.totalCount)}
              </div>
              <div className="text-caption text-smoke">done</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xl text-snow">{formatINR(live.actualCost ?? live.estCost)}</div>
              <div className="text-caption text-smoke">{live.actualCost != null ? "spent" : "est. cost"}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xl text-snow">{formatRelativeTime(data.run.createdAt)}</div>
              <div className="text-caption text-smoke">started</div>
            </div>
          </div>
        </div>

        <div className="mt-4 h-1 overflow-hidden rounded-full bg-ash">
          <div className="h-full rounded-full bg-smark-orange transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        {isTerminal && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-caption text-smoke">
              {live.status === "failed" ? "This run failed — check the lanes below for details." : "All jobs have settled."}
            </span>
            <Button onClick={() => router.push(`/projects/${projectId}/runs/${data.run.id}/review`)}>Review results →</Button>
          </div>
        )}
        {error && <div className="mt-3 text-caption text-smark-orange-soft">{error}</div>}
      </Card>

      {data.inStockLanes.length > 0 && (
        <Card padding="lg">
          <div className="mb-3 text-[15px] font-medium text-snow">Already in stock — skipped</div>
          <div className="flex flex-col gap-2">
            {data.inStockLanes.map((lane) => (
              <InStockRow key={lane.bomLineId} lane={lane} />
            ))}
          </div>
        </Card>
      )}

      {live.sourcingLanes.length === 0 ? (
        <EmptyState title="Nothing to source" description="Every line on this BOM was already in stock." />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {live.sourcingLanes.map((lane) => (
            <SourcingLaneCard key={lane.bomLineId} lane={lane} />
          ))}
        </div>
      )}
    </div>
  );
}
