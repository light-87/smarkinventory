import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableShell, TableHead, TableBody, Th, Tr, Td } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { EmployeeKpiRow } from "@/lib/pm/dashboard";

function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

export interface EmployeeKpiPanelProps {
  rows: EmployeeKpiRow[];
  /** Set when the employee filter narrows to one engineer — renders a single-row detail card instead of the table. */
  focusedUserId: string | null;
}

export function EmployeeKpiPanel({ rows, focusedUserId }: EmployeeKpiPanelProps) {
  const focused = focusedUserId ? rows.find((r) => r.userId === focusedUserId) : null;

  if (focused) {
    return (
      <Card padding="none">
        <CardHeader title={`Engineer KPI — ${focused.displayName}`} />
        <div className="grid grid-cols-2 gap-3.5 px-5 py-[18px] sm:grid-cols-5">
          <KpiTile label="Efficiency /10" value={formatScore(focused.efficiencyAvg)} />
          <KpiTile label="Effectiveness /5" value={formatScore(focused.effectivenessAvg)} />
          <KpiTile label="Hours in range" value={formatNumber(focused.hoursInRange, { decimals: 1 })} />
          <KpiTile label="Tasks completed" value={formatNumber(focused.tasksCompleted)} />
          <KpiTile label="Active tasks" value={formatNumber(focused.activeTasks)} />
        </div>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <CardHeader title="Employee KPI" meta={`${rows.length} engineer${rows.length === 1 ? "" : "s"}`} />
      <div className="px-5 py-[18px]">
        {rows.length === 0 ? (
          <EmptyState tone="subtle" title="No engineer activity matches the current filters" />
        ) : (
          <TableShell minWidth={680}>
            <TableHead>
              <Tr>
                <Th>Engineer</Th>
                <Th align="right">Efficiency /10</Th>
                <Th align="right">Effectiveness /5</Th>
                <Th align="right">Hours in range</Th>
                <Th align="right">Tasks completed</Th>
                <Th align="right">Active tasks</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <Tr key={row.userId}>
                  <Td className="text-snow">{row.displayName}</Td>
                  <Td align="right" mono>
                    {formatScore(row.efficiencyAvg)}
                  </Td>
                  <Td align="right" mono>
                    {formatScore(row.effectivenessAvg)}
                  </Td>
                  <Td align="right" mono>
                    {formatNumber(row.hoursInRange, { decimals: 1 })}
                  </Td>
                  <Td align="right" mono>
                    {row.tasksCompleted}
                  </Td>
                  <Td align="right" mono>
                    {row.activeTasks}
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

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
      <div className="font-mono text-2xl text-snow">{value}</div>
      <div className="mt-1 text-caption text-smoke">{label}</div>
    </div>
  );
}
