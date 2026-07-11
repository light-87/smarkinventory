import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { MemoryContextCard, StandardRuleRow } from "@/lib/runs/types";

/** AI-memory context preview (read-only digest summary — plan/tab-ordering-workspace.md §2.3). */
export function MemoryContextCardView({ memory }: { memory: MemoryContextCard }) {
  return (
    <Card padding="lg">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-snow">AI Memory added as context</span>
        <Chip mono>v{memory.version}</Chip>
      </div>
      <div className="mb-3.5 text-caption text-smoke">
        The planner reads {memory.activeCount} approved rule{memory.activeCount === 1 ? "" : "s"} for this order — summary only
      </div>
      {memory.preview.length === 0 ? (
        <div className="text-[13px] text-smoke">No active rules yet — nothing learned to apply.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {memory.preview.map((rule, i) => (
            <div key={i} className="flex items-baseline gap-2.5">
              <Chip tone="accent" size="sm">
                {rule.scope}
              </Chip>
              <span className="text-[13px] leading-normal text-silver-mist">{rule.text}</span>
            </div>
          ))}
          {memory.moreCount > 0 && <div className="text-caption text-graphite">+ {memory.moreCount} more rules applied</div>}
        </div>
      )}
    </Card>
  );
}

/** Read-only standard search ladder (FEATURES §7) — "change in Settings". */
export function StandardRulesCard({ rules }: { rules: StandardRuleRow[] }) {
  return (
    <Card padding="lg" tone="panel">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-snow">Standard search rules</span>
        <span className="text-caption text-graphite">read-only</span>
      </div>
      <div className="mb-4 text-caption text-smoke">
        Applied to every order · <Link href="/settings" className="text-smark-orange hover:underline">change in Settings</Link>
      </div>
      <div className="flex flex-col">
        {/* `key` alone collides when multiple custom rules exist (all key="custom"); rank is unique per row. */}
        {rules.map((rule) => (
          <div key={`${rule.key}-${rule.rank}`} className="flex items-center gap-3 border-b border-border-hairline py-2.5 last:border-0">
            <span className="flex size-[22px] flex-none items-center justify-center rounded-md bg-ash font-mono text-[11px] text-smoke">
              {rule.rank}
            </span>
            <span className="flex-1 text-[13px] text-silver-mist">{rule.label}</span>
            {rule.mandatory && <Chip tone="accent">required</Chip>}
          </div>
        ))}
      </div>
    </Card>
  );
}
