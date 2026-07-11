"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/projects/confirm-dialog";
import { formatDate, formatNumber } from "@/lib/format";
import type { BomListRow } from "@/lib/bom/queries";
import { deleteBomAction } from "@/app/(app)/projects/[projectId]/boms/actions";

const SOURCING_LABEL: Record<BomListRow["sourcingStatus"], string> = {
  draft: "Draft",
  sourced: "Sourced",
  ordered: "Ordered",
};

const SOURCING_TONE: Record<BomListRow["sourcingStatus"], "default" | "accent" | "success"> = {
  draft: "default",
  sourced: "accent",
  ordered: "success",
};

export interface BomListTableProps {
  projectId: string;
  boms: BomListRow[];
  /** Owner/employee — shows the per-row delete control. */
  writable?: boolean;
  /** BOM id → its newest run's id, present only when that run's status is "review" (desktop-web-handoff-prompt.md §2). */
  reviewRunIdByBom?: ReadonlyMap<string, string>;
}

/** BOMs list for a project (plan/tab-orders-projects.md R2-03) — name, split, ×N, sourcing status. */
export function BomListTable({ projectId, boms, writable = false, reviewRunIdByBom }: BomListTableProps) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<BomListRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  if (boms.length === 0) {
    return (
      <EmptyState
        title="No BOMs on this project yet"
        description="Upload a filled template, or build one in-app with the grid editor."
      />
    );
  }

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteBomAction({ projectId, bomId: pendingDelete.id });
      if (result.ok) {
        setPendingDelete(null);
        router.refresh();
      } else {
        setDeleteError(result.error);
      }
    });
  };

  return (
    <>
      <TableShell minWidth={720}>
        <TableHead>
          <Tr>
            <Th>Name</Th>
            <Th align="right">Lines</Th>
            <Th align="right">In stock</Th>
            <Th align="right">To order</Th>
            <Th>Build qty</Th>
            <Th>Status</Th>
            <Th>Uploaded</Th>
            {writable && (
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            )}
          </Tr>
        </TableHead>
        <TableBody>
          {boms.map((bom) => (
            <Tr key={bom.id} interactive onClick={() => router.push(`/projects/${projectId}/boms/${bom.id}`)}>
              <Td className="text-snow">{bom.name}</Td>
              <Td align="right" mono>
                {formatNumber(bom.lineCount)}
              </Td>
              <Td align="right" mono className="text-phosphor-green">
                {formatNumber(bom.inStock)}
              </Td>
              <Td align="right" mono className="text-smark-orange">
                {formatNumber(bom.toOrder)}
              </Td>
              <Td>
                <Chip tone="soft" mono>
                  ×{bom.buildQty}
                </Chip>
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <Chip tone={SOURCING_TONE[bom.sourcingStatus]}>{SOURCING_LABEL[bom.sourcingStatus]}</Chip>
                  {reviewRunIdByBom?.get(bom.id) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/projects/${projectId}/runs/${reviewRunIdByBom.get(bom.id)}/review`);
                      }}
                      className="inline-flex h-7 items-center rounded-full bg-smark-orange/15 px-2.5 text-[13px] font-medium text-smark-orange transition-colors hover:bg-smark-orange/25"
                    >
                      In review →
                    </button>
                  )}
                </div>
              </Td>
              <Td className="text-smoke">
                {formatDate(bom.createdAt)}
                {bom.uploadedByName ? ` · ${bom.uploadedByName}` : ""}
                {bom.createdInApp ? " · created in-app" : ""}
              </Td>
              {writable && (
                <Td>
                  <button
                    type="button"
                    aria-label={`Delete BOM ${bom.name}`}
                    title="Delete BOM"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteError(null);
                      setPendingDelete(bom);
                    }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-faint transition-colors hover:bg-charcoal hover:text-smark-orange"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M2.5 4h11M6.5 4V2.75c0-.41.34-.75.75-.75h1.5c.41 0 .75.34.75.75V4m2.75 0-.55 9.06a1 1 0 0 1-1 .94H5.3a1 1 0 0 1-1-.94L3.75 4M6.5 7v4M9.5 7v4"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </Td>
              )}
            </Tr>
          ))}
        </TableBody>
      </TableShell>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        description={
          <>
            <p>
              This removes the BOM and all {formatNumber(pendingDelete?.lineCount ?? 0)} of its lines. Cross-project
              demand from this BOM is released. This cannot be undone.
            </p>
            {deleteError && <p className="mt-2 text-smark-orange">{deleteError}</p>}
          </>
        }
        confirmLabel="Delete BOM"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </>
  );
}
