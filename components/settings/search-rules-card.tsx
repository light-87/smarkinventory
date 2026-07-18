"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { addOrderingRuleAction, removeOrderingRuleAction } from "@/lib/settings/actions";
import { isRulePinned, type OrderingRuleItem } from "@/lib/settings/types";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/**
 * Standard search rules card (plan/tab-settings.md §2/§5, FEATURES.md §7) —
 * editable here, read-only wherever the Ordering workspace mirrors it
 * (bom-pipeline, not yet built). The Package rung is pinned: no remove
 * control, lock icon + tooltip — enforced client-side here AND server-side
 * (lib/settings/rules.ts's `checkRuleRemovable`) AND at the DB itself
 * (migration 0004's CHECK + BEFORE DELETE trigger).
 */
export function SearchRulesCard({ rules }: { rules: OrderingRuleItem[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [isPending, startTransition] = useTransition();
  const [newRuleText, setNewRuleText] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  function addRule() {
    const text = newRuleText.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await addOrderingRuleAction({ text });
      if (result.ok) {
        setNewRuleText("");
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function removeRule(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const result = await removeOrderingRuleAction(id);
      setPendingId(null);
      if (result.ok) {
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader
        title="Standard search rules"
        meta={<span className="text-smoke">applied to every order</span>}
      />
      <CardBody>
        <p className="mb-3.5 text-caption text-smoke">
          Editable here · shown read-only inside each order&apos;s workspace.
        </p>
        <div className="flex flex-col">
          {rules.map(({ row, label }, index) => {
            const pinned = isRulePinned(row);
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 border-b border-border-faint py-2.5 last:border-b-0"
              >
                <span className="flex size-[22px] flex-none items-center justify-center rounded-md bg-ash font-mono text-xs text-smoke">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-silver-mist">{label}</span>
                {pinned ? (
                  <span
                    className="flex flex-none items-center gap-1.5"
                    title="Package match is mandatory — never substitutable"
                  >
                    <Chip tone="accent">required</Chip>
                    <span aria-hidden className="size-3.5 text-smoke">
                      <LockIcon />
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => removeRule(row.id)}
                    className="flex-none cursor-pointer text-xs text-smoke transition-colors hover:text-smark-orange disabled:opacity-50"
                  >
                    {pendingId === row.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex gap-2.5">
          <Input
            value={newRuleText}
            onChange={(e) => setNewRuleText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRule();
            }}
            placeholder="Add a search rule — e.g. Prefer RoHS-compliant parts"
            className="flex-1"
          />
          <Button onClick={addRule} loading={isPending} disabled={!newRuleText.trim()}>
            Add rule
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
