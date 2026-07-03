import { Card, SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate, formatINR } from "@/lib/format";
import type { ExpenseRow } from "@/types/db";

export interface PaymentsStripProps {
  payments: readonly ExpenseRow[];
}

/**
 * Overview payments strip (R2-15): income entries linked to this project,
 * entered via Expenses — "one finance ledger, two views". Owner + accountant
 * only (the page gates who ever calls this; RLS hides the rows regardless).
 */
export function PaymentsStrip({ payments }: PaymentsStripProps) {
  const total = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <Card padding="none">
      <div className="flex items-center justify-between border-b border-border-divider px-5 py-4">
        <SectionLabel>Payments received</SectionLabel>
        <span className="font-mono text-[15px] text-snow">{formatINR(total)}</span>
      </div>
      {payments.length === 0 ? (
        <div className="px-5 py-6 text-center text-caption text-smoke">No payments recorded against this project yet.</div>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
              <div className="flex items-center gap-2.5">
                <span className="text-smoke">{formatDate(p.entry_date)}</span>
                {p.is_draft && <Chip tone="accent">Draft</Chip>}
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
