import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableShell, TableHead, TableBody, Th, Tr, Td } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { DashboardProjectRow } from "@/lib/pm/dashboard";

/** Inline progress bar — same track/fill classes as components/portal/pm-dashboard.tsx's progress bar. */
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-well"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-smark-orange transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[12px] text-smoke">{pct}%</span>
    </div>
  );
}

export function ProjectsTable({ rows }: { rows: DashboardProjectRow[] }) {
  return (
    <Card padding="none">
      <CardHeader title="Projects" meta={`${rows.length} project${rows.length === 1 ? "" : "s"}`} />
      <div className="px-5 py-[18px]">
        {rows.length === 0 ? (
          <EmptyState tone="subtle" title="No projects match the current filters" />
        ) : (
          <TableShell minWidth={860}>
            <TableHead>
              <Tr>
                <Th>Project</Th>
                <Th>Client</Th>
                <Th>Progress</Th>
                <Th align="right">Est hrs</Th>
                <Th align="right">Actual hrs</Th>
                <Th align="right">Tasks</Th>
                <Th align="right">Open bugs</Th>
                <Th>Engineers</Th>
                <Th>Status</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="text-snow">{row.name}</Td>
                  <Td>{row.client ?? "—"}</Td>
                  <Td>
                    <ProgressBar pct={row.progressPct} />
                  </Td>
                  <Td align="right" mono>
                    {formatNumber(row.estimatedHours, { decimals: 1 })}
                  </Td>
                  <Td align="right" mono>
                    {formatNumber(row.actualHours, { decimals: 1 })}
                  </Td>
                  <Td align="right" mono>
                    {row.tasksDone}/{row.tasksTotal}
                  </Td>
                  <Td align="right" mono>
                    {row.openBugs}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {row.assignees.length === 0 ? (
                        <span className="text-smoke">—</span>
                      ) : (
                        row.assignees.map((name) => (
                          <Chip key={name} tone="neutral" size="sm">
                            {name}
                          </Chip>
                        ))
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Chip tone={row.archived ? "default" : "success"} size="sm">
                      {row.archived ? "Archived" : "Active"}
                    </Chip>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </TableShell>
        )}
      </div>
    </Card>
  );
}
