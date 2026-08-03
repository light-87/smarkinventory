"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { formatCompDays, STANDARD_ANNUAL_COMP_DAYS } from "@/lib/attendance/comp-days";
import { setCompBalanceAction, setCompEntitlementAction } from "@/lib/attendance/actions";
import type { CompLedgerEntryView } from "@/lib/attendance/comp-ledger";
import { formatDate } from "@/lib/format";

export interface CompOffAdminCardProps {
  userId: string;
  employeeName: string;
  balanceDays: number;
  annualDays: number;
  ledger: CompLedgerEntryView[];
  today: string;
}

const SOURCE_LABEL: Record<CompLedgerEntryView["sourceKind"], string> = {
  overtime: "Extra hours",
  comp_work: "Worked a holiday",
  leave: "Comp leave taken",
  grant: "Yearly entitlement",
  reset: "Year-end reset",
  manual: "Owner adjustment",
};

/**
 * Owner-only comp-off controls for one employee (migration 0020).
 *
 * Two things the client asked for that the old hours model had nowhere to put:
 *
 *  - Setting the balance outright. The app is taking over balances that
 *    already exist on paper, so the owner has to be able to say "he has six
 *    days" without inventing overtime claims that add up to it.
 *  - A yes/no on the yearly entitlement, per person, instead of the app
 *    inferring it from length of service.
 *
 * The history below is the reason both are safe to hand over: every movement
 * says what caused it and who was behind it, so an adjustment is auditable
 * rather than a number that silently changed.
 */
export function CompOffAdminCard({
  userId,
  employeeName,
  balanceDays,
  annualDays,
  ledger,
  today,
}: CompOffAdminCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [balanceDraft, setBalanceDraft] = useState(String(balanceDays));
  const [note, setNote] = useState("");

  const entitled = annualDays > 0;

  function saveBalance() {
    const next = Number(balanceDraft);
    if (!Number.isFinite(next) || next < 0) {
      push({ msg: "Enter the balance in days (0 or more)." });
      return;
    }
    if (Math.round(next * 2) !== next * 2) {
      push({ msg: "Use whole or half days." });
      return;
    }
    startTransition(async () => {
      const result = await setCompBalanceAction({
        userId,
        balanceDays: next,
        entryDate: today,
        note: note.trim() || null,
      });
      if (result.ok) {
        push({ msg: `${employeeName}'s comp-off set to ${formatCompDays(next)}` });
        setNote("");
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function toggleEntitlement() {
    startTransition(async () => {
      const result = await setCompEntitlementAction({ userId, entitled: !entitled });
      if (result.ok) {
        push({
          msg: entitled
            ? "Yearly comp-off entitlement turned off"
            : `Entitled to ${STANDARD_ANNUAL_COMP_DAYS} days each January`,
        });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="Comp-off" meta={<span className="font-mono">{formatCompDays(balanceDays)}</span>} />
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
          <div>
            <div className="text-[15px] text-snow">Yearly entitlement</div>
            <p className="text-caption text-smoke">
              {entitled
                ? `${formatCompDays(annualDays)} granted every 1 January. Unused days are cleared at the same time.`
                : "Not entitled — this employee only earns comp-off from extra hours and holiday work."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone={entitled ? "success" : "default"} size="sm">
              {entitled ? "On" : "Off"}
            </Chip>
            <Button size="sm" variant="outline" loading={pending} onClick={toggleEntitlement}>
              {entitled ? "Turn off" : "Turn on"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-charcoal bg-surface-panel p-4">
          <div>
            <div className="text-[15px] text-snow">Set the balance</div>
            <p className="text-caption text-smoke">
              Use this to carry over a balance from before the app, or to correct a mistake. Recorded as an adjustment
              with your name on it.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Balance (days)" className="w-32">
              <Input type="number" min="0" step="0.5" value={balanceDraft} onChange={(e) => setBalanceDraft(e.target.value)} />
            </Field>
            <Field label="Reason (optional)" className="min-w-[200px] flex-1">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. carried over from the register" />
            </Field>
            <Button size="sm" loading={pending} onClick={saveBalance}>
              Save
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[15px] text-snow">History</div>
          {ledger.length === 0 ? (
            <p className="text-caption text-smoke">No comp-off movements yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-hairline">
              {ledger.slice(0, 12).map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[15px] text-snow">{SOURCE_LABEL[entry.sourceKind]}</div>
                    <div className="text-caption text-smoke">
                      {formatDate(entry.entryDate)}
                      {entry.note && ` · ${entry.note}`}
                    </div>
                  </div>
                  <span
                    className={`flex-none font-mono text-[15px] ${entry.deltaDays > 0 ? "text-phosphor-green" : "text-smark-orange-soft"}`}
                  >
                    {entry.deltaDays > 0 ? "+" : ""}
                    {entry.deltaDays}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
