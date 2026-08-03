"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export interface GuideStep {
  title: string;
  body: string;
  /** The concrete "what happens when you do this" line, so the reader can predict the effect before clicking. */
  outcome: string;
}

export interface GuideScenario {
  q: string;
  a: string;
}

export interface HowToGuideProps {
  title: string;
  /** localStorage key for the collapsed state. Distinct per guide so hiding one doesn't hide the rest. */
  storageKey: string;
  steps: readonly GuideStep[];
  scenarios?: readonly GuideScenario[];
  /** Heading above the scenarios block. */
  scenariosTitle?: string;
  /**
   * Whether the panel starts open on a device that has never touched it.
   * Defaults to CLOSED for every guide: these pages are daily drivers, and a
   * guide that pushes the real work below the fold on every visit earns
   * resentment rather than readers. A stored preference still wins, so anyone
   * who deliberately left a guide open keeps it open.
   */
  defaultOpen?: boolean;
}

/**
 * Collapsible in-app how-to panel. Generalised from the owner-only PM guide so
 * the same shape can carry the employee guides too: staff had no instructions
 * anywhere in the app, and the module they use most (attendance and comp-off)
 * is the one with rules worth stating.
 *
 * Always visible as a header bar so it can be re-opened, with the open/closed
 * choice remembered per guide in localStorage. Caret-disclosure idiom from
 * inventory/facet-sidebar.
 */
export function HowToGuide({
  title,
  storageKey,
  steps,
  scenarios,
  scenariosTitle = "Common “what if…” questions",
  defaultOpen = false,
}: HowToGuideProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    // One-time read of the persisted collapse preference on mount — the
    // pattern react-hooks/set-state-in-effect explicitly allows (matches
    // components/shelves/AuditLauncher.tsx).
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(stored === "0");
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, next ? "0" : "1");
      return next;
    });
  }

  return (
    <Card tone="panel" className="flex flex-col gap-0 border-smark-orange/20 bg-surface-accent p-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left"
      >
        <span aria-hidden className={cn("text-[12px] text-faint transition-transform", open ? "rotate-90" : "rotate-0")}>
          ▶
        </span>
        <span className="text-[15px] font-medium text-snow">{title}</span>
        <span className="ml-auto text-caption text-faint">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-border-divider px-4 py-4">
          <ol className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex size-6 flex-none items-center justify-center rounded-full bg-surface-well font-mono text-caption text-smoke">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] text-snow">{step.title}</div>
                  <p className="mt-0.5 text-caption text-faint">{step.body}</p>
                  <p className="mt-1 text-caption text-smoke">
                    <span className="text-smark-orange">What happens: </span>
                    {step.outcome}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {scenarios && scenarios.length > 0 && (
            <div className="mt-5 border-t border-border-divider pt-4">
              <div className="mb-2 text-[15px] font-medium text-snow">{scenariosTitle}</div>
              <ul className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-2.5">
                {scenarios.map((s) => (
                  <li key={s.q} className="min-w-0">
                    <div className="text-caption font-medium text-snow">{s.q}</div>
                    <p className="mt-0.5 text-caption text-faint">{s.a}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
