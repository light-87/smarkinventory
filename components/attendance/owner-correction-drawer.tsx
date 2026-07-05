"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerFooter, DrawerHeader } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { ownerCorrectAttendanceAction } from "@/lib/attendance/actions";

export interface OwnerCorrectionDrawerProps {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  targetUserName: string;
  workDate: string;
  currentCheckIn?: string | null;
  currentCheckOut?: string | null;
}

function toTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Owner backfill/correction drawer for a user's attendance on one day — reuses lib/daily/core.ownerSetAttendance via lib/attendance/actions.ts. */
export function OwnerCorrectionDrawer({
  open,
  onClose,
  targetUserId,
  targetUserName,
  workDate,
  currentCheckIn,
  currentCheckOut,
}: OwnerCorrectionDrawerProps) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [checkInTime, setCheckInTime] = useState(toTimeInput(currentCheckIn));
  const [checkOutTime, setCheckOutTime] = useState(toTimeInput(currentCheckOut));
  const [note, setNote] = useState("");

  if (!open) return null;

  function submit() {
    startTransition(async () => {
      const result = await ownerCorrectAttendanceAction({
        userId: targetUserId,
        workDate,
        checkInTime: checkInTime || null,
        checkOutTime: checkOutTime || null,
        note: note || null,
      });
      if (result.ok) {
        push({ msg: `Attendance updated for ${targetUserName}.` });
        router.refresh();
        onClose();
      } else {
        push({ msg: result.error });
      }
    });
  }

  return (
    <Drawer open={open} onClose={onClose} width={380} aria-label="Correct attendance">
      <DrawerHeader>
        <div>
          <div className="text-[15px] text-snow">{targetUserName}</div>
          <div className="text-caption text-smoke">{formatDate(workDate)}</div>
        </div>
        <DrawerCloseButton onClick={onClose} />
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in">
            <Input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
          </Field>
          <Field label="Check out">
            <Input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Correction reason" />
        </Field>
      </DrawerBody>
      <DrawerFooter>
        <Button variant="outline" fullWidth onClick={onClose}>
          Cancel
        </Button>
        <Button fullWidth onClick={submit} loading={pending}>
          Save
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
