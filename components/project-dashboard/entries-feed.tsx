import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableShell, TableHead, TableBody, Th, Tr, Td } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/format";
import type { TimeLogEntriesPage } from "@/lib/pm/dashboard";

export interface EntriesFeedProps {
  page: TimeLogEntriesPage;
  currentPage: number;
  pageSize: number;
  /** Every other current query param (filters + group), so paging doesn't drop them. */
  baseParams: Record<string, string>;
}

export function EntriesFeed({ page, currentPage, pageSize, baseParams }: EntriesFeedProps) {
  const totalPages = Math.max(1, Math.ceil(page.total / pageSize));
  const hrefFor = (p: number) => `/project-dashboard?${new URLSearchParams({ ...baseParams, entriesPage: String(p) }).toString()}`;

  return (
    <Card padding="none">
      <CardHeader title="Time log entries" meta={`${page.total} entr${page.total === 1 ? "y" : "ies"} in range`} />
      <div className="px-5 py-[18px]">
        {page.rows.length === 0 ? (
          <EmptyState tone="subtle" title="No time logged in this range" />
        ) : (
          <>
            <TableShell minWidth={720}>
              <TableHead>
                <Tr>
                  <Th>Engineer</Th>
                  <Th>Date</Th>
                  <Th>Project</Th>
                  <Th>Task</Th>
                  <Th align="right">Hours</Th>
                  <Th>Description</Th>
                </Tr>
              </TableHead>
              <TableBody>
                {page.rows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="text-snow">{row.engineerName}</Td>
                    <Td>{formatDate(row.workDate)}</Td>
                    <Td>{row.projectName}</Td>
                    <Td>{row.taskTitle}</Td>
                    <Td align="right" mono>
                      {formatNumber(row.hours, { decimals: 1 })}
                    </Td>
                    <Td className="max-w-[280px] truncate">{row.description}</Td>
                  </Tr>
                ))}
              </TableBody>
            </TableShell>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-[15px] text-smoke">
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  {currentPage > 1 && (
                    <Link href={hrefFor(currentPage - 1)} className="rounded-lg border border-charcoal px-3 py-1.5 text-snow hover:bg-ash">
                      ‹ Prev
                    </Link>
                  )}
                  {currentPage < totalPages && (
                    <Link href={hrefFor(currentPage + 1)} className="rounded-lg border border-charcoal px-3 py-1.5 text-snow hover:bg-ash">
                      Next ›
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
