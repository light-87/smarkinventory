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
        className={`relative inline-flex h-6 w-11 flex-none cursor-pointer items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-smark-orange/40 disabled:opacity-50 ${
          show ? "bg-smark-orange" : "bg-slate"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${
            show ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </Card>
  );
}
