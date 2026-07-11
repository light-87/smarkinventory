# Prompt for the web-app agent — Ordering Workspace cleanup (desktop pivot)

> **✅ Implemented (Plan #3).** The "Run ordering →" button, the vestigial
> "Search depth"/dry-run ₹ card, and the now-dead `runOrderingAction` (+ its
> `RunOrderingInput` schema) were removed. The "In review →" CTA is surfaced on
> the BOM list, the BOM detail page, and the ordering workspace's saved-run
> card. `enqueueRun`/`createDesktopRun`/the worker path were kept (§1's
> "do not delete" note conflated the dead `runOrderingAction` wrapper with the
> load-bearing `enqueueRun` — only the wrapper was removed). Kept below as the
> historical spec.

## Context

SmarkStock Desktop (a separate Tauri companion app, `desktop/app`) is now the
real path for browser-agent BOM sourcing — it drives a real browser through
the user's own Claude Code session, end-to-end proven working (see
`docs/TESTING-FINDINGS.md`'s P1c entry). It creates its own runs directly via
`POST /api/desktop/run-context` (`createDesktopRun` in `lib/runs/enqueue.ts`),
independently of anything on the web app — the desktop app *pulls* BOMs from
Supabase on its own; nothing on the web side needs to "send" it anything.

Two decided changes needed on the web app as a result:

## 1. Remove the "Run ordering →" button

**File:** `components/ordering/workspace-view.tsx`
**Current behavior:** the button (`onClick={runOrdering}`, only rendered
when `writable && !nothingToOrder`) calls `runOrderingAction` →
`enqueueRun` (`lib/runs/enqueue.ts`) — the old worker-based path — then
navigates to `/projects/${projectId}/runs/${result.runId}`.

**Decision:** remove this button entirely. Browser-agent sourcing now happens
exclusively through the SmarkStock Desktop app, not from the web UI. Replace
the button area with a short instructional note instead of an action, e.g.
something like: *"Source this BOM from the SmarkStock Desktop app on your
computer."* (exact copy is yours to write well — keep it short, plain,
non-apologetic per the house writing voice).

**Do NOT delete** `enqueueRun` itself, `runOrderingAction`, or the worker path
— those still back the desktop app's sibling function `createDesktopRun` and
the underlying `smark_order_jobs`/worker infra remains load-bearing
elsewhere. This is a UI-only removal on this one page.

## 2. Add automatic "in review" surfacing (a real gap, independent of #1)

Confirmed via a repo-wide search: **no page currently surfaces a "this run is
in review, click here" link automatically.** The only way to reach a review
screen today is to already know the run ID and navigate to
`/projects/[projectId]/runs/[runId]/review` by hand. This applies equally to
worker-created and desktop-created runs (there's no UI distinction between
them today — `plan.appMeta.executor` is desktop-only backend metadata, not
read by any component).

**Ask:** wherever a BOM or project's current run status is shown (BOM list,
project overview — whatever the natural spot is in the existing IA), surface
a clear call-to-action once that BOM's most recent run has
`smark_agent_runs.status === "review"` — a badge/button linking straight to
`/projects/[projectId]/runs/[runId]/review`. This should work identically
regardless of whether the run was desktop- or worker-created.

## Schema reference (already confirmed, no need to re-derive)

- `smark_boms.sourcing_status`: `"draft" | "sourced" | "ordered"`
  (`types/db.ts` `BomSourcingStatusSchema`)
- `smark_agent_runs.status`: `"planning" | "running" | "review" | "done" | "failed"`
  (`types/db.ts` `AgentRunStatusSchema`)
- "Ordered" is the fully-terminal state — the desktop app's own BOM picker
  now excludes `sourcing_status = "ordered"` BOMs for the same reason (nothing
  left to source).
