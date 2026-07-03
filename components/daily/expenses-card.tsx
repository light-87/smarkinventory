import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatINR } from "@/lib/format";
import type { ExpenseDailyRow } from "@/lib/daily/queries";

export interface ExpensesCardProps {
  rows: ExpenseDailyRow[] | null;
  error?: string | null;
}

/** Section 4 — Expenses today (owner + accountant ONLY — FEATURES.md §5.13, §2). */
export function ExpensesCard({ rows, error }: ExpensesCardProps) {
  return (
    <Card padding="none">
      <CardHeader title="Expenses today" />

      {error || !rows ? (
        <div className="px-5 py-6 text-body-sm text-smoke">{error ?? "Expenses unavailable."}</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-5">
          <EmptyState tone="subtle" title="No entries" description="Expenses and income added today will show up here." />
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 border-b border-border-faint px-5 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Chip tone={row.entryType === "income" ? "success" : "default"} size="sm">
                    {row.entryType}
                  </Chip>
                  <span className="truncate text-body-sm text-snow">{row.category}</span>
                  {row.isDraft && (
                    <Chip tone="accent" size="sm">
                      draft
                    </Chip>
                  )}
                </div>
                {(row.vendor || row.note) && (
                  <div className="mt-1 truncate text-caption text-smoke">{[row.vendor, row.note].filter(Boolean).join(" · ")}</div>
                )}
              </div>
              <span className="flex-none font-mono text-[13px] text-snow">{formatINR(row.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
