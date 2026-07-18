"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "pm-guide-collapsed";

/** `outcome` = the concrete "what happens when you do this" line, so owners can predict the effect before they click. */
const STEPS: readonly { title: string; body: string; outcome: string }[] = [
  {
    title: "Create a project",
    body: "One project per client job. Add BOMs and documents from the tabs above.",
    outcome: "A new project card appears in the list. Nothing is shared with the client until you generate a portal link.",
  },
  {
    title: "Add tasks",
    body: "Break the work into tasks and assign engineers with estimated hours.",
    outcome: "Each assigned engineer sees the task under their “My tasks” and the estimate is locked in for the efficiency comparison later.",
  },
  {
    title: "Engineers log time & submit",
    body: "Each engineer logs the hours they spend, then submits the task for your review.",
    outcome: "The task moves to “Submitted” and lands in your review queue. The engineer can no longer edit it until you send it back or mark it done.",
  },
  {
    title: "You mark it done",
    body: "Review submitted tasks and mark them done. Efficiency compares estimate vs actual hours.",
    outcome: "Project progress % goes up, the client portal reflects the new completion, and the engineer's efficiency score updates from estimate vs actual.",
  },
  {
    title: "Handle issues in Approvals",
    body: "Anyone can report a bug or request a change — confirm, dismiss, or turn it into a new task.",
    outcome: "Confirm a bug → it counts against effectiveness. Accept a change request → it becomes a new task you assign. The client sees the outcome in their portal.",
  },
  {
    title: "Waiting on the client?",
    body: "Put a task on hold and send an email reminder from the task's Manage panel.",
    outcome: "The task shows “Awaiting your input” to the client (amber) and pauses its clock. It resumes when the client marks their input provided.",
  },
  {
    title: "Share progress",
    body: "Generate a read-only client link from the Manage tab — no login needed for the client.",
    outcome: "The client opens the link to see tasks, schedule, and documents — read-only. Regenerating the link instantly invalidates the old one.",
  },
];

/** Quick "what if…" answers for the non-obvious edge cases owners actually hit. */
const SCENARIOS: readonly { q: string; a: string }[] = [
  {
    q: "What if I reject a change request?",
    a: "No task is created and the client sees “Not taken up” in their portal. Nothing else changes — you can still accept a resubmitted one later.",
  },
  {
    q: "What if I dismiss a reported bug?",
    a: "It's marked reviewed with no change and does not count against anyone's effectiveness. The reporter sees “Reviewed — no change”.",
  },
  {
    q: "What if I reassign a task mid-way?",
    a: "Logged hours stay with the task. The new engineer picks up from the current state; the estimate is unchanged.",
  },
  {
    q: "What if I regenerate the client link?",
    a: "The previous link stops working immediately. Anyone still on the old URL is locked out until you share the new one.",
  },
  {
    q: "What if I archive a project?",
    a: "It drops off the active list and its client link stops resolving. Data is kept — you can view it via the Archived filter.",
  },
];

/**
 * Collapsible "How Project Management works" guide. Always visible as a header
 * bar (so it's re-openable); the open/closed choice is remembered in
 * localStorage. Uses the caret-disclosure idiom from inventory/facet-sidebar.
 */
export function PmGuide() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // One-time read of the persisted collapse preference on mount — the
    // pattern react-hooks/set-state-in-effect explicitly allows (matches
    // components/shelves/AuditLauncher.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(STORAGE_KEY) === "1") setOpen(false);
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "0" : "1");
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
        <span className="text-[15px] font-medium text-snow">How Project Management works</span>
        <span className="ml-auto text-caption text-faint">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-border-divider px-4 py-4">
          <ol className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
            {STEPS.map((step, i) => (
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

          <div className="mt-5 border-t border-border-divider pt-4">
            <div className="mb-2 text-[15px] font-medium text-snow">Common “what if…” questions</div>
            <ul className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-2.5">
              {SCENARIOS.map((s) => (
                <li key={s.q} className="min-w-0">
                  <div className="text-caption font-medium text-snow">{s.q}</div>
                  <p className="mt-0.5 text-caption text-faint">{s.a}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
