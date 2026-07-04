"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { updateBuildQtyAction } from "@/app/(app)/projects/[projectId]/boms/actions";
import { DnpBadge } from "./status-chip";
import type { BomLineRow } from "@/types/db";
import type { BomRow } from "@/types/db";

export interface ReconcileViewProps {
  bom: BomRow;
  lines: BomLineRow[];
  writable: boolean;
}

/** "tolerance_pct" → "tolerance pct" — extra-column keys are slugs, headers should read like words. */
function extraKeyLabel(key: string): string {
  return key.replace(/_/g, " ");
}

/**
 * `part_link` is an arbitrary cell from an uploaded xlsx — only ever render
 * it as a link when it's a real http(s) URL, never `javascript:`/`data:` etc.
 */
function safePartLink(raw: string | null): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : null;
}

/**
 * Per-BOM detail (plan/tab-orders-projects.md §2/§5): build-qty ×N + the
 * uploaded sheet mirrored IN FULL — every parsed column, every row, exactly
 * what the AI pipeline will read. Deliberately NO in-stock/to-order stats and
 * NO per-line match status here (manual-test decision: stock checking is the
 * agents' job during a run, not this page's — reconcile still runs silently
 * on upload/×N change to feed cross-project demand).
 */
export function ReconcileView({ bom, lines, writable }: ReconcileViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [buildQty, setBuildQty] = useState(String(bom.build_qty));
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-5">
      {bom.priority_notes && (
        <Card tone="panel">
          <div className="text-caption text-smoke uppercase">Priorities</div>
          <div className="mt-1 text-[13px] text-snow">{bom.priority_notes}</div>
        </Card>
      )}

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
          {formatNumber(lines.length)} lines — every line&rsquo;s need = qty × build qty. The AI run reads this sheet
          as-is.
        </p>
      </Card>

      {error && <div className="text-caption text-smark-orange-soft">{error}</div>}

      <TableShell minWidth={1400 + extraKeys.length * 120}>
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
                {safePartLink(line.part_link) ? (
                  <a
                    href={safePartLink(line.part_link)!}
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
