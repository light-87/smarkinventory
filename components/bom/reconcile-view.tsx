"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { computeReconcileStats } from "@/lib/bom/reconcile";
import { updateBuildQtyAction, reconcileBomAction } from "@/app/(app)/projects/[projectId]/boms/actions";
import { DnpBadge, LineStatusChip } from "./status-chip";
import type { BomDetailLine } from "@/lib/bom/queries";
import type { BomRow } from "@/types/db";

export interface ReconcileViewProps {
  bom: BomRow;
  lines: BomDetailLine[];
  writable: boolean;
}

/** "tolerance_pct" → "tolerance pct" — extra-column keys are slugs, headers should read like words. */
function extraKeyLabel(key: string): string {
  return key.replace(/_/g, " ");
}

/**
 * Per-BOM reconcile view (plan/tab-orders-projects.md §2/§5): stat trio,
 * build-qty ×N, lines table. The table renders the uploaded file IN FULL —
 * every parsed column including Description/Manufacturer/PartLink and any
 * custom extras (manual-test feedback: the BOM screen must mirror the file
 * as-is; Status is informational, the AI pipeline reads the raw lines).
 */
export function ReconcileView({ bom, lines, writable }: ReconcileViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [buildQty, setBuildQty] = useState(String(bom.build_qty));
  const [error, setError] = useState<string | null>(null);

  const stats = computeReconcileStats(lines.map((l) => ({ matchState: l.match_state })));
  const hasLcsc = lines.some((l) => l.lcsc_pn);
  const hasNotes = lines.some((l) => l.priority_note);
  const extraKeys = Array.from(new Set(lines.flatMap((l) => (l.extra ? Object.keys(l.extra) : []))));

  function saveBuildQty() {
    setError(null);
    const qty = Number.parseInt(buildQty, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setError("Build qty must be at least 1.");
      return;
    }
    startTransition(async () => {
      const result = await updateBuildQtyAction({ bomId: bom.id, buildQty: qty });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function reReconcile() {
    setError(null);
    startTransition(async () => {
      const result = await reconcileBomAction(bom.id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {bom.priority_notes && (
        <Card tone="panel">
          <div className="text-caption text-smoke uppercase">Priorities</div>
          <div className="mt-1 text-[13px] text-snow">{bom.priority_notes}</div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard value={formatNumber(stats.lines)} label="Lines" mono />
        <StatCard value={formatNumber(stats.inStock)} label="In stock" tone="success" mono />
        <StatCard value={formatNumber(stats.toOrder)} label="To order" tone="accent" mono />
      </div>

      <Card padding="lg" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] text-silver-mist">Build qty ×N</label>
          <div className="flex items-center gap-2">
            <Input
              uiSize="sm"
              value={buildQty}
              onChange={(e) => setBuildQty(e.target.value)}
              type="number"
              inputMode="numeric"
              mono
              disabled={!writable}
              className="w-24"
            />
            {writable && (
              <Button size="sm" variant="outline" onClick={saveBuildQty} loading={isPending}>
                Save
              </Button>
            )}
          </div>
        </div>
        <p className="text-[13px] text-smoke">
          Every line&rsquo;s need = qty × build qty. Changing it re-reconciles the split immediately.
        </p>
        {writable && (
          <Button className="ml-auto" size="sm" variant="ghost" onClick={reReconcile} loading={isPending}>
            Re-reconcile
          </Button>
        )}
      </Card>

      {error && <div className="text-caption text-smark-orange-soft">{error}</div>}

      <TableShell minWidth={1480 + extraKeys.length * 120}>
        <TableHead>
          <Tr>
            <Th>#</Th>
            <Th>Reference</Th>
            <Th align="right">Qty</Th>
            <Th>Value</Th>
            <Th>Footprint</Th>
            <Th>Description</Th>
            <Th>MPN</Th>
            <Th>Manufacturer</Th>
            {hasLcsc && <Th>LCSC</Th>}
            <Th>Link</Th>
            {hasNotes && <Th>Note</Th>}
            {extraKeys.map((key) => (
              <Th key={key} className="capitalize">
                {extraKeyLabel(key)}
              </Th>
            ))}
            <Th>Status</Th>
          </Tr>
        </TableHead>
        <TableBody>
          {lines.map((line) => (
            <Tr key={line.id}>
              <Td mono className="text-smoke">
                {line.line_no ?? "—"}
              </Td>
              <Td mono>
                <div className="flex items-center gap-1.5">
                  <span className="max-w-[260px] truncate" title={line.references ?? undefined}>
                    {line.references ?? "—"}
                  </span>
                  {line.dnp && <DnpBadge />}
                </div>
              </Td>
              <Td align="right" mono>
                {line.qty ?? "—"}
              </Td>
              <Td>{line.value ?? "—"}</Td>
              <Td className="text-smoke">{line.footprint ?? "—"}</Td>
              <Td className="text-smoke">
                <span className="block max-w-[280px] truncate" title={line.description ?? undefined}>
                  {line.description ?? "—"}
                </span>
              </Td>
              <Td mono>{line.mpn ?? "—"}</Td>
              <Td className="text-smoke">{line.manufacturer ?? "—"}</Td>
              {hasLcsc && <Td mono>{line.lcsc_pn ?? "—"}</Td>}
              <Td>
                {line.part_link ? (
                  <a
                    href={line.part_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-silver-mist underline underline-offset-2 transition-colors hover:text-snow"
                    onClick={(e) => e.stopPropagation()}
                  >
                    open ↗
                  </a>
                ) : (
                  <span className="text-smoke">—</span>
                )}
              </Td>
              {hasNotes && <Td className="text-smoke">{line.priority_note ?? "—"}</Td>}
              {extraKeys.map((key) => {
                const raw = line.extra?.[key];
                return (
                  <Td key={key} className="text-smoke">
                    {raw === null || raw === undefined ? "—" : String(raw)}
                  </Td>
                );
              })}
              <Td>
                <LineStatusChip
                  matchState={line.match_state}
                  contestedShortfall={line.contestedShortfall}
                  locationLabel={line.location ? `Shelf ${line.location.shelfCode} · ${line.location.boxName}` : null}
                />
              </Td>
            </Tr>
          ))}
        </TableBody>
      </TableShell>

      <div>
        <Link href={`/projects/${bom.project_id}/ordering/${bom.id}`}>
          <Button size="lg">Set up ordering →</Button>
        </Link>
        <p className="mt-2 text-caption text-smoke">Sequence, priorities, tier, then run AI sourcing.</p>
      </div>
    </div>
  );
}
