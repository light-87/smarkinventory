"use client";

import { useRouter } from "next/navigation";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/format";
import type { BomListRow } from "@/lib/bom/queries";

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
}

/** BOMs list for a project (plan/tab-orders-projects.md R2-03) — name, split, ×N, sourcing status. */
export function BomListTable({ projectId, boms }: BomListTableProps) {
  const router = useRouter();

  if (boms.length === 0) {
    return (
      <EmptyState
        title="No BOMs on this project yet"
        description="Upload a filled template, or build one in-app with the grid editor."
      />
    );
  }

  return (
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
              <Chip tone={SOURCING_TONE[bom.sourcingStatus]}>{SOURCING_LABEL[bom.sourcingStatus]}</Chip>
            </Td>
            <Td className="text-smoke">
              {formatDate(bom.createdAt)}
              {bom.uploadedByName ? ` · ${bom.uploadedByName}` : ""}
              {bom.createdInApp ? " · created in-app" : ""}
            </Td>
          </Tr>
        ))}
      </TableBody>
    </TableShell>
  );
}
