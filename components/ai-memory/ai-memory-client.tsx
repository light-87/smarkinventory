"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { approveRuleAction, rejectRuleAction, retireRuleAction } from "@/lib/ai/actions";
import type { AiMemoryScreenData } from "@/lib/ai/types";
import { SuggestedRuleCard } from "./suggested-rule-card";
import { ActiveRulesTable } from "./active-rules-table";
import { RunLogSection } from "./run-log-section";

export interface AiMemoryClientProps {
  data: AiMemoryScreenData;
}

/**
 * `/ai-memory` (plan/tab-ai-memory.md, owner-only — the page's own
 * server-side `canSee` guard already 404s anyone else before this ever
 * mounts). Optimistically removes/moves rows on approve/reject/retire so
 * the screen doesn't wait on a full page reload; the Server Actions'
 * `revalidatePath("/ai-memory")` keeps the next navigation consistent
 * either way.
 */
export function AiMemoryClient({ data }: AiMemoryClientProps) {
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [suggested, setSuggested] = useState(data.suggested);
  const [active, setActive] = useState(data.active);
  const [digestVersion, setDigestVersion] = useState(data.digest.version);
  const [latestDiff, setLatestDiff] = useState(data.digest.latestDiff);

  function handleApprove(ruleId: string) {
    setPendingId(ruleId);
    startTransition(async () => {
      const result = await approveRuleAction(ruleId);
      setPendingId(null);
      if (!result.ok) {
        push({ msg: result.error });
        return;
      }
      const rule = suggested.find((r) => r.id === ruleId);
      setSuggested((prev) => prev.filter((r) => r.id !== ruleId));
      if (rule) setActive((prev) => [...prev, { ...rule, status: "active" }]);
      if (result.docVersion != null) {
        setDigestVersion(result.docVersion);
        setLatestDiff(`v${result.docVersion - 1} → v${result.docVersion}: +1 rule (${rule?.ruleText ?? "rule"})`);
      }
      push({ msg: "Rule approved — digest updated" });
    });
  }

  function handleReject(ruleId: string) {
    setPendingId(ruleId);
    startTransition(async () => {
      const result = await rejectRuleAction(ruleId);
      setPendingId(null);
      if (!result.ok) {
        push({ msg: result.error });
        return;
      }
      setSuggested((prev) => prev.filter((r) => r.id !== ruleId));
      push({ msg: "Rule rejected" });
    });
  }

  function handleRetire(ruleId: string) {
    setPendingId(ruleId);
    startTransition(async () => {
      const result = await retireRuleAction(ruleId);
      setPendingId(null);
      if (!result.ok) {
        push({ msg: result.error });
        return;
      }
      const rule = active.find((r) => r.id === ruleId);
      setActive((prev) => prev.filter((r) => r.id !== ruleId));
      if (result.docVersion != null) {
        setDigestVersion(result.docVersion);
        setLatestDiff(`v${result.docVersion - 1} → v${result.docVersion}: -1 rule (${rule?.ruleText ?? "rule"})`);
      }
      push({ msg: "Rule retired — takes effect on the next run" });
    });
  }

  return (
    <div className="mx-auto max-w-[960px] px-6 py-7 pb-24">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-normal text-snow">AI Memory</h1>
        <span className="rounded-full border border-charcoal px-3.5 py-[5px] font-mono text-[13px] text-silver-mist">
          Rules v{digestVersion}
        </span>
      </div>
      <p className="mb-6 max-w-[640px] text-[13px] text-smoke">
        These rules are advisory and fully reviewable. Nothing here trains or changes the AI model — it just reads your
        saved preferences.
        {latestDiff && (
          <>
            {" "}
            Latest diff: <span className="font-mono text-smark-orange">{latestDiff}</span>
          </>
        )}
      </p>

      {suggested.length > 0 && (
        <div className="mb-8">
          <div className="mb-3 text-[11px] tracking-[0.06em] text-smark-orange uppercase">
            Suggested rules · {suggested.length} awaiting review
          </div>
          <div className="flex flex-col gap-2.5">
            {suggested.map((rule) => (
              <SuggestedRuleCard
                key={rule.id}
                rule={rule}
                pending={isPending && pendingId === rule.id}
                onApprove={() => handleApprove(rule.id)}
                onReject={() => handleReject(rule.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mb-8">
        <ActiveRulesTable rules={active} pendingId={isPending ? pendingId : null} onRetire={handleRetire} />
      </div>

      <RunLogSection entries={data.runLog} />
    </div>
  );
}
