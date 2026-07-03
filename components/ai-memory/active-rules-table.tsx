import { SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableBody, TableHead, TableShell, Td, Th, Tr } from "@/components/ui/table";
import type { ActiveRuleItem } from "@/lib/ai/types";
import { confidenceTone, formatConfidence, scopeLabel } from "./format";

export interface ActiveRulesTableProps {
  rules: ActiveRuleItem[];
  pendingId: string | null;
  onRetire: (ruleId: string) => void;
}

/** Active rules table (prototype `isMemory`: Scope · Subject · Rule · Confidence · Retire). */
export function ActiveRulesTable({ rules, pendingId, onRetire }: ActiveRulesTableProps) {
  return (
    <div>
      <SectionLabel className="mb-3">Active rules</SectionLabel>
      {rules.length === 0 ? (
        <EmptyState tone="subtle" title="No active rules yet" description="Approve a suggested rule to seed the digest." />
      ) : (
        <TableShell minWidth={760} wrapperClassName="rounded-lg border border-charcoal">
          <TableHead>
            <Tr>
              <Th>Scope</Th>
              <Th>Subject</Th>
              <Th>Rule</Th>
              <Th>Confidence</Th>
              <Th aria-label="Actions" />
            </Tr>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <Tr key={rule.id}>
                <Td className="whitespace-nowrap text-smoke">{scopeLabel(rule.scope)}</Td>
                <Td className="text-snow">{rule.subject ?? "All"}</Td>
                <Td>{rule.ruleText}</Td>
                <Td>
                  <Chip tone={confidenceTone(rule.confidence)} size="sm">
                    {formatConfidence(rule.confidence)}
                  </Chip>
                </Td>
                <Td align="right">
                  <button
                    type="button"
                    disabled={pendingId === rule.id}
                    onClick={() => onRetire(rule.id)}
                    className="cursor-pointer bg-transparent text-xs text-smoke transition-colors hover:text-smark-orange-hover disabled:pointer-events-none disabled:opacity-50"
                  >
                    Retire
                  </button>
                </Td>
              </Tr>
            ))}
          </TableBody>
        </TableShell>
      )}
    </div>
  );
}
