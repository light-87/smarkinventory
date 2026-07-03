"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ChartBucket } from "@/lib/expenses/types";

const OPTIONS = [
  { value: "month" as ChartBucket, label: "Monthly" },
  { value: "quarter" as ChartBucket, label: "Quarterly" },
  { value: "year" as ChartBucket, label: "Yearly" },
];

export function PeriodSwitcher({ value, onChange }: { value: ChartBucket; onChange: (v: ChartBucket) => void }) {
  return <SegmentedControl options={OPTIONS} value={value} onChange={onChange} variant="accent" aria-label="Chart period" />;
}
