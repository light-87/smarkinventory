"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { assignOnboardingLocationAction } from "@/lib/receive/actions";
import type { OnboardingRow } from "@/lib/receive/queries";
import type { BoxOption } from "@/lib/receive/storage-suggestion";
import { NativeSelect } from "./native-select";

export interface OnboardingQueueProps {
  rows: readonly OnboardingRow[];
  boxes: readonly BoxOption[];
}

const PAGE_SIZE = 25;

/**
 * Onboarding queue — drains the Stock-List import backlog (FEATURES.md §14:
 * "the source has zero location data"): parts with `needs_review` or no
 * stock location yet. "Assign & print" places the already-known imported
 * qty into a Shelf → Box and queues exactly one label.
 */
export function OnboardingQueue({ rows, boxes }: OnboardingQueueProps) {
  const { push } = useToast();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [boxId, setBoxId] = useState("");
  const [newBoxName, setNewBoxName] = useState("");
  const [shelfCode, setShelfCode] = useState("");
  const [esdNote, setEsdNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());

  const boxOptions = useMemo(() => boxes.map((b) => ({ value: b.id, label: `${b.name} · Shelf ${b.shelfCode}` })), [boxes]);

  const pending = rows.filter((r) => !done.has(r.part.id));
  const visible = pending.slice(0, visibleCount);

  function openRow(row: OnboardingRow) {
    setOpenRowId(row.part.id);
    setBoxId(row.suggestion?.id ?? "");
    setNewBoxName("");
    setShelfCode("");
    setEsdNote("");
  }

  function submitAssign(partId: string) {
    if (!boxId && !(newBoxName && shelfCode)) {
      push({ msg: "Pick a box, or provide a new box name + shelf" });
      return;
    }
    startTransition(async () => {
      const result = await assignOnboardingLocationAction({
        partId,
        boxId: boxId || undefined,
        newBoxName: boxId ? undefined : newBoxName,
        shelfCode: boxId ? undefined : shelfCode,
        esdNote: esdNote || undefined,
      });
      if (result.ok) {
        push({ msg: `${result.internalPid} assigned${result.labelQueued ? " — label queued" : ""}` });
        setDone((prev) => new Set(prev).add(partId));
        setOpenRowId(null);
      } else {
        push({ msg: result.error });
      }
    });
  }

  if (rows.length === 0) return null;

  return (
    <Card padding="none">
      <CardHeader title={`${pending.length} need a location`} meta="onboarding queue" />
      {visible.map((row) => {
        const isOpen = openRowId === row.part.id;
        return (
          <div key={row.part.id} className="border-t border-border-hairline">
            <button
              type="button"
              onClick={() => (isOpen ? setOpenRowId(null) : openRow(row))}
              className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[14px] text-snow">
                {row.part.mpn ?? row.part.internal_pid}
              </span>
              <span className="text-caption text-smoke">
                {[row.part.value, row.part.package].filter(Boolean).join(" · ") || "—"}
              </span>
              {row.hasLocation && (
                <Chip tone="warn" size="sm">
                  flagged for review
                </Chip>
              )}
              {row.suggestion && !row.hasLocation && (
                <span className="font-mono text-caption text-silver-mist">
                  → {row.suggestion.name} · Shelf {row.suggestion.shelfCode}
                </span>
              )}
            </button>

            {isOpen && !row.hasLocation && (
              <div className="bg-surface-panel border-t border-border-divider px-5 py-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px] flex-1">
                    <div className="mb-1.5 text-[14px] text-silver-mist">Existing box</div>
                    <NativeSelect
                      options={boxOptions}
                      value={boxId}
                      onChange={(e) => {
                        setBoxId(e.target.value);
                        if (e.target.value) {
                          setNewBoxName("");
                          setShelfCode("");
                        }
                      }}
                      placeholder="Pick a box…"
                    />
                  </div>
                  <span className="pb-2.5 text-caption text-faint">or</span>
                  <div className="min-w-[140px]">
                    <div className="mb-1.5 text-[14px] text-silver-mist">New box name</div>
                    <Input
                      value={newBoxName}
                      onChange={(e) => {
                        setNewBoxName(e.target.value);
                        if (e.target.value) setBoxId("");
                      }}
                      placeholder="A-12"
                      mono
                    />
                  </div>
                  <div className="min-w-[100px]">
                    <div className="mb-1.5 text-[14px] text-silver-mist">Shelf</div>
                    <Input value={shelfCode} onChange={(e) => setShelfCode(e.target.value)} placeholder="A" mono />
                  </div>
                  <div className="min-w-[160px] flex-1">
                    <div className="mb-1.5 text-[14px] text-silver-mist">ESD note (optional)</div>
                    <Input value={esdNote} onChange={(e) => setEsdNote(e.target.value)} placeholder="reel + working box" />
                  </div>
                  <Button onClick={() => submitAssign(row.part.id)} loading={isPending}>
                    Assign &amp; print
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {pending.length > visibleCount && (
        <div className="border-t border-border-hairline p-3 text-center">
          <Button variant="ghost" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, pending.length - visibleCount)} more
          </Button>
        </div>
      )}
    </Card>
  );
}
