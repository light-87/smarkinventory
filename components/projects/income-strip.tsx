import { Card, SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate, formatINR } from "@/lib/format";
import type { ProjectIncomeRow } from "@/lib/pm/queries";

export interface IncomeStripProps {
  income: readonly ProjectIncomeRow[];
}

/**
 * Overview income strip — carried forward from the old payments strip
 * (`smark_expenses`, entry_type='income'). Owner + accountant only (the page
 * gates who ever calls this; RLS additionally scopes the rows).
 */
export function IncomeStrip({ income }: IncomeStripProps) {
  const total = income.reduce((sum, p) => sum + p.amount, 0);

  return (
    <Card padding="none">
      <div className="flex items-center justify-between border-b border-border-divider px-5 py-4">
        <SectionLabel>Payments received</SectionLabel>
        <span className="font-mono text-[17px] text-snow">{formatINR(total)}</span>
      </div>
      {income.length === 0 ? (
        <div className="px-5 py-6 text-center text-caption text-smoke">No payments recorded against this project yet.</div>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {income.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
              <div className="flex items-center gap-2.5">
                <span className="text-smoke">{formatDate(p.entryDate)}</span>
                {p.isDraft && <Chip tone="accent">Draft</Chip>}
                {p.vendor && <span className="text-silver-mist">{p.vendor}</span>}
              </div>
              <span className="font-mono text-snow">{formatINR(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
