"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { useAgentRunsFeed } from "@/hooks/use-agent-runs-feed";
import type { AgentRunFeedRow } from "@/lib/dashboard/queries";
import {
  formatElapsed,
  formatFinishedAgo,
  formatLaneProgress,
  isRunActive,
  runStatusLabel,
  runStatusTone,
} from "@/lib/dashboard/compute";

/**
 * Dashboard's agent-activity card (plan/tab-dashboard.md, FEATURES §5.1) —
 * replaces the WF-1 placeholder now that `smark_agent_runs` has a real
 * writer path (worker package). Prototype (SmarkStock.dc.html `isDashboard`)
 * shows exactly one orange "running" box + one plain "completed" box; this
 * extends that same visual language to the real multi-run shape (R2-03: a
 * project's BOMs can run in parallel) — every active run gets its own orange
 * box, the rest render as plain rows underneath, oldest falling off the
 * fetch window (lib/dashboard/queries.ts `getRecentAgentRuns`, default 5).
 *
 * Each row links to the run's BOM page — the real per-run "console"
 * (bom-pipeline's `app/(app)/projects/[projectId]/runs/**`, plan/
 * tab-agent-run.md) isn't built yet; see notes-for-integrator.
 */
export function AgentActivityCard({
  initialRuns,
  error,
}: {
  initialRuns: AgentRunFeedRow[] | null;
  error?: string | null;
}) {
  return (
    <Card>
      <div className="mb-4 text-[15px] font-medium text-snow">Agent activity</div>
      {error || !initialRuns ? (
        <div className="text-body-sm text-smoke">{error ?? "Agent activity unavailable."}</div>
      ) : (
        <AgentRunsList initialRuns={initialRuns} />
      )}
    </Card>
  );
}

function AgentRunsList({ initialRuns }: { initialRuns: AgentRunFeedRow[] }) {
  const runs = useAgentRunsFeed(initialRuns);

  if (runs.length === 0) {
    return (
      <EmptyState
        tone="subtle"
        title="No runs yet"
        description="Start a sourcing run from a project's BOM to see live agent progress here."
      />
    );
  }

  const active = runs.filter((r) => isRunActive(r.status));
  const recent = runs.filter((r) => !isRunActive(r.status));

  return (
    <div className="flex flex-col gap-3">
      {active.map((run) => (
        <ActiveRunRow key={run.id} run={run} />
      ))}
      {recent.map((run) => (
        <RecentRunRow key={run.id} run={run} />
      ))}
    </div>
  );
}

/**
 * `bom_id` is a NOT NULL, RESTRICT-on-delete FK (a BOM can't be removed while
 * a run references it — see 0004_ordering_finance.sql), so the join in
 * `getRecentAgentRuns` should never actually miss. Still, `projectId` falls
 * back to "" defensively (join failure of some future kind) — render a plain,
 * non-clickable row rather than ship a broken `/projects//boms/x` link.
 */
function RunRowLink({ run, className, children }: { run: AgentRunFeedRow; className?: string; children: ReactNode }) {
  if (!run.projectId) {
    return <div className={cn("block rounded-xl", className)}>{children}</div>;
  }
  return (
    <Link href={`/projects/${run.projectId}/boms/${run.bomId}`} className={cn("block rounded-xl", className)}>
      {children}
    </Link>
  );
}

function ActiveRunRow({ run }: { run: AgentRunFeedRow }) {
  const pctKnown = run.laneProgress.done != null && run.laneProgress.total;
  const pct =
    pctKnown && run.laneProgress.total
      ? Math.round(((run.laneProgress.done as number) / run.laneProgress.total) * 100)
      : null;

  return (
    <RunRowLink
      run={run}
      className="border border-smark-orange bg-surface-accent p-3.5 transition-colors hover:bg-surface-accent-hover"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[13px] text-snow">{run.bomName}</span>
        <Chip tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Chip>
      </div>
      <div className="mb-2.5 truncate text-[12px] text-smoke">
        {run.projectName} · {formatLaneProgress(run.laneProgress)} · {run.cost.text}
        {run.cost.isEstimate ? " est." : ""}
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-ash">
        <div
          className={cn(
            "h-full rounded-full bg-smark-orange",
            pct === null && "w-full animate-pulse opacity-40",
          )}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span className="truncate">{run.startedByName ?? "—"}</span>
        {/* `formatElapsed`'s default `reference: Date = new Date()` is evaluated once at SSR time and again at hydration — a real gap under any latency (and this suite's own shared-`next dev`-process contention docs elsewhere confirm it's not always sub-second). The text is meant to read "as of right now" and this row already re-renders every poll tick (use-agent-runs-feed.ts) with a fresh client clock, so freezing it to the server's instant isn't right either — suppress rather than fight the intentionally-live value. */}
        <span className="flex-none" suppressHydrationWarning>
          {formatElapsed(run.createdAt)}
        </span>
      </div>
    </RunRowLink>
  );
}

function RecentRunRow({ run }: { run: AgentRunFeedRow }) {
  return (
    <RunRowLink
      run={run}
      className="border border-charcoal p-3.5 transition-colors hover:border-graphite hover:bg-surface-hover"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[13px] text-snow">{run.bomName}</span>
        <Chip tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Chip>
      </div>
      <div className="truncate text-[12px] text-smoke">
        {run.projectName} · {formatLaneProgress(run.laneProgress)} · {run.cost.text}
        {run.cost.isEstimate ? " est." : ""}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
        <span className="truncate">{run.startedByName ?? "—"}</span>
        {/* Same intentionally-live "as of right now" value as ActiveRunRow's formatElapsed above — see that comment. */}
        <span className="flex-none" suppressHydrationWarning>
          {formatFinishedAgo(run.updatedAt ?? run.createdAt)}
        </span>
      </div>
    </RunRowLink>
  );
}
