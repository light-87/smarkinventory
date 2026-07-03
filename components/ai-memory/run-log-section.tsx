import { SectionLabel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import type { RuleRunLogItem } from "@/lib/ai/types";

export interface RunLogSectionProps {
  entries: RuleRunLogItem[];
}

/**
 * Run-log: which rule hit which line (plan/tab-ai-memory.md §4). Traced
 * from rule provenance (feedback → run/line) until bom-pipeline/worker
 * write per-line rule citations directly onto `smark_agent_results` — see
 * `lib/ai/queries.ts`'s `getRuleRunLog` doc comment. Empty state is
 * expected and fine (no rule has originated from feedback yet).
 */
export function RunLogSection({ entries }: RunLogSectionProps) {
  return (
    <div>
      <SectionLabel className="mb-3">Run log — which rule hit which line</SectionLabel>
      {entries.length === 0 ? (
        <EmptyState
          tone="subtle"
          title="No rule citations yet"
          description="Once a rule created from review feedback is approved, the run and line it came from will show up here."
        />
      ) : (
        <TableShell minWidth={640} wrapperClassName="rounded-lg border border-charcoal">
          <TableHead>
            <Tr>
              <Th>Rule</Th>
              <Th>Line</Th>
              <Th>Run</Th>
              <Th align="right">When</Th>
            </Tr>
          </TableHead>
          <TableBody>
            {entries.map((entry, i) => (
              <Tr key={`${entry.ruleId}-${entry.runId}-${i}`}>
                <Td>{entry.ruleText}</Td>
                <Td mono>{entry.lineDescriptor ?? "Whole-order remark"}</Td>
                <Td mono className="text-smoke">
                  {entry.runId.slice(0, 8)}
                </Td>
                <Td align="right" className="text-smoke">
                  {new Date(entry.occurredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </Td>
              </Tr>
            ))}
          </TableBody>
        </TableShell>
      )}
    </div>
  );
}
