"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { PartFieldTemplateRow } from "@/types/db";
import type { ArrivedPoGroup, OnboardingRow } from "@/lib/receive/queries";
import type { BoxOption } from "@/lib/receive/storage-suggestion";
import { NewPartForm } from "./new-part-form";
import { OnboardingQueue } from "./onboarding-queue";
import { PrintQueueStrip } from "./print-queue-strip";
import { PutAwayList } from "./put-away-list";
import { TopUpForm } from "./top-up-form";

export type ReceiveCard = "new-part" | "top-up" | "put-away";

const CARDS: { id: ReceiveCard; title: string; description: string }[] = [
  { id: "new-part", title: "New part", description: "Category, value, package, qty — we suggest a box." },
  { id: "top-up", title: "Top up existing (scan)", description: "Scan a PID, add qty — no reprint." },
  { id: "put-away", title: "Put away arrivals", description: "Arrived order lines, grouped by PO." },
];

export interface ReceiveScreenProps {
  boxes: readonly BoxOption[];
  customFieldTemplates: readonly PartFieldTemplateRow[];
  arrivedGroups: readonly ArrivedPoGroup[];
  onboardingRows: readonly OnboardingRow[];
  queuedLabelCount: number;
  defaultCard?: ReceiveCard;
  presetBoxId?: string | null;
  /**
   * FEATURES.md §2: accountant sees Receive but is read-only. The server
   * actions already reject accountant writes (`requireReceiveWriter`), but
   * without this the UI half of the "enforced twice" matrix was missing —
   * an accountant could fill in New part / Top up / Put away and only learn
   * it's read-only on submit. Defaults to `true` so existing callers that
   * don't pass it (none in this app) keep today's behavior.
   */
  canWrite?: boolean;
}

/**
 * Three flat action cards [R2-23] — one tap to the right form, no toggle
 * archaeology (client: "make it simple to use"). Plus the print queue strip
 * and onboarding queue, both always visible below.
 */
export function ReceiveScreen({
  boxes,
  customFieldTemplates,
  arrivedGroups,
  onboardingRows,
  queuedLabelCount,
  defaultCard = "new-part",
  presetBoxId,
  canWrite = true,
}: ReceiveScreenProps) {
  const [active, setActive] = useState<ReceiveCard>(defaultCard);
  const [topUpPresetPid, setTopUpPresetPid] = useState<string | null>(null);
  const arrivedCount = arrivedGroups.reduce((sum, g) => sum + g.lines.length, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6">
      <h1 className="text-heading-sm font-normal text-snow">Receive stock</h1>

      {canWrite ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CARDS.map((card) => {
              const isActive = active === card.id;
              const badge = card.id === "put-away" && arrivedCount > 0 ? arrivedCount : null;
              return (
                <Card
                  key={card.id}
                  interactive
                  tone={isActive ? "surface" : "panel"}
                  className={isActive ? "border-smark-orange" : undefined}
                  onClick={() => setActive(card.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[15px] text-snow">{card.title}</div>
                    {badge !== null && (
                      <span className="flex-none rounded-full bg-smark-orange px-2 py-0.5 font-mono text-[11px] text-white">
                        {badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-caption text-smoke">{card.description}</div>
                </Card>
              );
            })}
          </div>

          {active === "new-part" && (
            <NewPartForm
              boxes={boxes}
              initialCustomFieldTemplates={customFieldTemplates}
              presetBoxId={presetBoxId}
              onSwitchToTopUp={(pid) => {
                setTopUpPresetPid(pid);
                setActive("top-up");
              }}
            />
          )}
          {active === "top-up" && <TopUpForm presetPid={topUpPresetPid} />}
          {active === "put-away" && <PutAwayList groups={arrivedGroups} />}
        </>
      ) : (
        <EmptyState
          tone="subtle"
          title="Read-only"
          description="Your role can view Receive but can't add or move stock here."
        />
      )}

      <PrintQueueStrip initialCount={queuedLabelCount} />

      <OnboardingQueue rows={onboardingRows} boxes={boxes} />
    </div>
  );
}
