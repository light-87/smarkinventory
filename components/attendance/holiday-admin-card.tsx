"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { addHolidayAction, removeHolidayAction, setWeeklyOffAction } from "@/lib/attendance/actions";
import type { HolidayView } from "@/lib/attendance/queries";

export interface HolidayAdminCardProps {
  holidays: readonly HolidayView[];
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Owner-only holiday admin — add specific dates, set weekly-off day(s) (prompt: Owner bullet). */
export function HolidayAdminCard({ holidays }: HolidayAdminCardProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");

  const specific = holidays.filter((h) => h.kind === "specific").sort((a, b) => (a.holidayDate ?? "").localeCompare(b.holidayDate ?? ""));
  const weeklyOffDays = new Set(holidays.filter((h) => h.kind === "weekly_off").map((h) => h.weekday));
  const weeklyOffRows = holidays.filter((h) => h.kind === "weekly_off");

  function addSpecific() {
    if (!newDate || !newName.trim()) {
      push({ msg: "Pick a date and give it a name." });
      return;
    }
    startTransition(async () => {
      const result = await addHolidayAction({ holidayDate: newDate, name: newName.trim() });
      if (result.ok) {
        push({ msg: "Holiday added." });
        setNewDate("");
        setNewName("");
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  function toggleWeekday(weekday: number) {
    const existing = weeklyOffRows.find((h) => h.weekday === weekday);
    startTransition(async () => {
      if (existing) {
        const result = await removeHolidayAction({ id: existing.id });
        if (!result.ok) push({ msg: result.error });
        else router.refresh();
      } else {
        const result = await setWeeklyOffAction({ weekday, name: `${WEEKDAY_NAMES[weekday]} off` });
        if (!result.ok) push({ msg: result.error });
        else router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await removeHolidayAction({ id });
      if (result.ok) {
        push({ msg: "Removed." });
        router.refresh();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card padding="none">
      <CardHeader title="Holidays" />
      <div className="flex flex-col gap-5 px-5 py-[18px]">
        <div>
          <div className="mb-2 text-[15px] font-medium text-snow">Weekly off</div>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((label, weekday) => (
              <button
                key={weekday}
                type="button"
                disabled={pending}
                onClick={() => toggleWeekday(weekday)}
                className={`h-9 min-w-11 cursor-pointer rounded-full border px-3 text-[15px] transition-colors disabled:opacity-50 ${
                  weeklyOffDays.has(weekday)
                    ? "border-smark-orange bg-surface-accent text-smark-orange"
                    : "border-charcoal text-smoke hover:bg-ash hover:text-snow"
                }`}
              >
                {label.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border-faint pt-4">
          <div className="mb-2 text-[15px] font-medium text-snow">Add a specific date</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Date">
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </Field>
            <Field label="Name" className="min-w-[160px] flex-1">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Diwali" />
            </Field>
            <Button size="sm" onClick={addSpecific} loading={pending}>
              Add
            </Button>
          </div>
        </div>

        <div className="border-t border-border-faint pt-4">
          <div className="mb-2 text-[15px] font-medium text-snow">Upcoming / all specific dates</div>
          {specific.length === 0 ? (
            <EmptyState tone="subtle" title="No specific holidays yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {specific.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Chip tone="neutral" mono>
                      {h.holidayDate ? formatDate(h.holidayDate) : "—"}
                    </Chip>
                    <span className="text-[15px] text-snow">{h.name}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(h.id)} loading={pending}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
