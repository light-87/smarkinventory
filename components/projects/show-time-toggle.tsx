"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionLabel } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { setShowTimeToClientAction } from "@/lib/pm/actions";

export interface ShowTimeToggleProps {
  projectId: string;
  initialValue: boolean;
}

/** Owner toggle: whether the client portal shows estimated/actual hours per task. */
export function ShowTimeToggle({ projectId, initialValue }: ShowTimeToggleProps) {
  const router = useRouter();
  const { push } = useToast();
  const [show, setShow] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !show;
    setShow(next);
    startTransition(async () => {
      const result = await setShowTimeToClientAction({ projectId, show: next });
      if (result.ok) {
        router.refresh();
      } else {
        setShow(!next);
        push({ msg: result.error });
      }
    });
  }

  return (
    <Card className="flex items-center justify-between gap-3">
      <div>
        <SectionLabel>Hours on client portal</SectionLabel>
        <p className="mt-1 text-caption text-smoke">
          {show ? "Estimated + actual hours are visible to the client." : "Hours are hidden from the client."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={show}
        disabled={isPending}
        onClick={toggle}
        className={`relative h-7 w-12 flex-none cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
          show ? "border-smark-orange bg-smark-orange" : "border-charcoal bg-surface-well"
        }`}
      >
        <span
          className={`absolute top-[3px] size-[22px] rounded-full bg-obsidian transition-transform ${
            show ? "translate-x-[23px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </Card>
  );
}
