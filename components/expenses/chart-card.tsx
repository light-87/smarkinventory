import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export interface ChartCardProps {
  title: ReactNode;
  meta?: ReactNode;
  /** When false, renders the empty-state instead of `children` (chart honesty — no fake axes on zero data). */
  hasData: boolean;
  emptyLabel?: string;
  height?: number;
  children: ReactNode;
}

/**
 * Shared card shell for every Expenses chart — fixed-height plot region so
 * ResponsiveContainer has a real box to fill, and a consistent "nothing to
 * show yet" state instead of an empty axis pair (dataviz skill: don't fake a
 * chart when there's no data).
 */
export function ChartCard({ title, meta, hasData, emptyLabel = "No data for this period yet.", height = 260, children }: ChartCardProps) {
  return (
    <Card padding="none">
      <CardHeader title={title} meta={meta} />
      <div style={{ height }} className="px-2 py-3">
        {hasData ? (
          children
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState tone="subtle" description={emptyLabel} className="w-full py-0" />
          </div>
        )}
      </div>
    </Card>
  );
}
