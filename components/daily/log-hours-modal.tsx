"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { logHoursAction, ownerSetAttendanceAction, updateHoursAction } from "@/lib/daily/actions";
import type { ProjectOption, TimeEntryView } from "@/lib/daily/queries";

export interface PersonDayModalProps {
  open: boolean;
  onClose: () => void;
  /** "self-hours" — logging your own hours only. "owner-day" — owner correcting anyone's attendance + hours. */
  mode: "self-hours" | "owner-day";
  targetUserId: string;
  targetUserName: string;
  workDate: string;
  projectOptions: readonly ProjectOption[];
  existingEntries: readonly TimeEntryView[];
  /** owner-day mode only — prefills the attendance correction fields. */
  currentCheckIn?: string | null;
  currentCheckOut?: string | null;
  currentProjectId?: string | null;
}

function toTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * "Log hours" (self) / "Manage {person}'s day" (owner) drawer — FEATURES.md
 * §5.13 manual hours entry + "owner can add/correct anyone's entries".
 * One component covers both call sites (attendance-section.tsx) so the
 * hours-list-plus-add-form isn't duplicated.
 */
export function PersonDayModal({
  open,
  onClose,
  mode,
  targetUserId,
  targetUserName,
  workDate,
  projectOptions,
  existingEntries,
  currentCheckIn,
  currentCheckOut,
  currentProjectId,
}: PersonDayModalProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();

  const [newProjectId, setNewProjectId] = useState(projectOptions[0]?.id ?? "");
  const [newHours, setNewHours] = useState("");
  const [newNote, setNewNote] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHours, setEditHours] = useState("");
  const [editNote, setEditNote] = useState("");

  const [checkInTime, setCheckInTime] = useState(toTimeInput(currentCheckIn));
  const [checkOutTime, setCheckOutTime] = useState(toTimeInput(currentCheckOut));
  const [attendanceProjectId, setAttendanceProjectId] = useState(currentProjectId ?? "");

  if (!open) return null;

  function refreshAndMaybeClose(close: boolean) {
    router.refresh();
    if (close) onClose();
  }

  function submitNewHours() {
    const hours = Number(newHours);
    if (!newProjectId) {
      push({ msg: "Pick a project first." });
      return;
    }
    if (!(hours > 0)) {
      push({ msg: "Enter hours greater than 0." });
      return;
    }
    startTransition(async () => {
      const result = await logHoursAction({
        userId: targetUserId,
        projectId: newProjectId,
        workDate,
        hours,
        note: newNote || null,
      });
      if (result.ok) {
        push({ msg: `Logged ${hours}h for ${targetUserName}.` });
        setNewHours("");
        setNewNote("");
        refreshAndMaybeClose(false);
      } else {
        push({ msg: result.error });
      }
    });
  }

  function submitEditHours(id: string) {
    const hours = Number(editHours);
    if (!(hours > 0)) {
      push({ msg: "Enter hours greater than 0." });
      return;
    }
    startTransition(async () => {
      const result = await updateHoursAction({ id, hours, note: editNote || null });
      if (result.ok) {
        push({ msg: "Hours updated." });
        setEditingId(null);
        refreshAndMaybeClose(false);
      } else {
        push({ msg: result.error });
      }
    });
  }

  function submitAttendance() {
    startTransition(async () => {
      const result = await ownerSetAttendanceAction({
        userId: targetUserId,
        workDate,
        checkInTime: checkInTime || null,
        checkOutTime: checkOutTime || null,
        projectId: attendanceProjectId || null,
      });
      if (result.ok) {
        push({ msg: `Attendance updated for ${targetUserName}.` });
        refreshAndMaybeClose(false);
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Drawer open={open} onClose={onClose} width={420} aria-label="Manage day">
      <DrawerHeader>
        <div>
          <div className="text-[16px] text-snow">
            {mode === "owner-day" ? `${targetUserName}'s day` : "Log hours"}
          </div>
          <div className="text-caption text-smoke">{formatDate(workDate)}</div>
        </div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-5">
        {mode === "owner-day" && (
          <Card tone="panel">
            <div className="mb-3 text-[14px] font-medium text-snow">Attendance</div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Check in">
                  <Input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
                </Field>
                <Field label="Check out">
                  <Input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
                </Field>
              </div>
              {projectOptions.length > 0 && (
                <Field label="Working on">
                  <select
                    value={attendanceProjectId}
                    onChange={(e) => setAttendanceProjectId(e.target.value)}
                    className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
                  >
                    <option value="">No project</option>
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Button variant="outline" size="sm" onClick={submitAttendance} loading={pending}>
                Save attendance
              </Button>
            </div>
          </Card>
        )}

        <div>
          <div className="mb-3 text-[14px] font-medium text-snow">Hours logged</div>
          {existingEntries.length === 0 ? (
            <p className="text-caption text-smoke">Nothing logged for this day yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {existingEntries.map((entry) => (
                <Card key={entry.id} tone="panel" padding="md">
                  {editingId === entry.id ? (
                    <div className="flex flex-col gap-2">
                      <div className="text-[14px] text-snow">{entry.projectName}</div>
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        value={editHours}
                        onChange={(e) => setEditHours(e.target.value)}
                        uiSize="sm"
                      />
                      <Input
                        placeholder="Note (optional)"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        uiSize="sm"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => submitEditHours(entry.id)} loading={pending}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] text-snow">{entry.projectName}</div>
                        {entry.note && <div className="truncate text-caption text-smoke">{entry.note}</div>}
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <span className="font-mono text-[14px] text-silver-mist">{entry.hours}h</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditHours(String(entry.hours));
                            setEditNote(entry.note ?? "");
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 text-[14px] font-medium text-snow">Add hours</div>
          {projectOptions.length === 0 ? (
            <p className="text-caption text-smoke">
              No projects assigned yet — ask the owner to add {mode === "owner-day" ? "this person" : "you"} to a
              project first.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label="Project">
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-charcoal bg-surface-well px-3.5 text-sm text-snow outline-none focus:border-smark-orange"
                >
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hours">
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="24"
                  value={newHours}
                  onChange={(e) => setNewHours(e.target.value)}
                  placeholder="e.g. 6.5"
                />
              </Field>
              <Field label="Note (optional)">
                <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="What did you work on?" />
              </Field>
            </div>
          )}
        </div>
      </DrawerBody>

      <DrawerFooter>
        <Button variant="outline" fullWidth onClick={onClose}>
          Close
        </Button>
        {projectOptions.length > 0 && (
          <Button fullWidth onClick={submitNewHours} loading={pending}>
            Add hours
          </Button>
        )}
      </DrawerFooter>
    </Drawer>
  );
}
