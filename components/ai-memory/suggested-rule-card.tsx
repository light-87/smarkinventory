import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { SuggestedRuleItem } from "@/lib/ai/types";
import { scopeLabel } from "./format";

export interface SuggestedRuleCardProps {
  rule: SuggestedRuleItem;
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
}

/** Orange-bordered suggested-rule card (prototype `isMemory`: scope pill · subject · rule text · source quote · Approve/Reject). */
export function SuggestedRuleCard({ rule, pending, onApprove, onReject }: SuggestedRuleCardProps) {
  const value = rule.value as Record<string, unknown> | null;
  const source = typeof value?.source === "string" ? value.source : null;

  return (
    <Card className="border-smark-orange bg-[#161210]" padding="md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-[15px] text-snow">
            <Chip tone="default" size="sm" className="mr-2">
              {scopeLabel(rule.scope)}
            </Chip>
            {rule.subject ?? "All"}
          </div>
          <div className="mt-2 text-[15px] text-snow">{rule.ruleText}</div>
          {source && <div className="mt-1.5 text-xs text-smoke">from &ldquo;{source}&rdquo;</div>}
        </div>
        <div className="flex flex-none items-start gap-2">
          <Button size="sm" variant="primary" loading={pending} onClick={onApprove}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={onReject}>
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}
