import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { effectiveCanSee } from "@/lib/rbac/access";
import {
  getDashboardStats,
  getRecentAgentRuns,
  getRecentMovements,
  getUsageByProject,
} from "@/lib/dashboard/queries";
import { StatGrid } from "@/components/dashboard/stat-grid";
import { RecentMovementsCard } from "@/components/dashboard/recent-movements-card";
import { AgentActivityCard } from "@/components/dashboard/agent-activity-card";
import { UsageByProjectCard } from "@/components/dashboard/usage-by-project-card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Inventory Dashboard" };

interface Section<T> {
  data: T | null;
  error: string | null;
}

/** Each section fails independently — one bad query never blanks the whole page (same contract as /dashboard). */
async function loadSection<T>(promise: Promise<T>): Promise<Section<T>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

/**
 * `/inventory-dashboard` — the stock-side numbers that used to sit on the
 * main dashboard: units in stock, low/out counts, inventory value, recent
 * movements, agent activity and per-project part usage.
 *
 * They moved here because the owner's main dashboard is now about people and
 * projects (the client's ask: "the admin don't want to see the inventory
 * stuff, the unit stock stuff, the recent movement, the event activity"), but
 * the data itself is still wanted — just on its own screen, reachable from
 * the Inventory group in the nav.
 *
 * Gated on the "inventory" area, so an employee needs the inventory module
 * grant to reach it, exactly like /inventory itself.
 */
export default async function InventoryDashboardPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  // Never render nothing: an empty return paints a blank content area inside
  // the shell, which is indistinguishable from a broken page and is exactly
  // what a user reports as "blank screen, had to refresh". The layout already
  // redirects an unauthenticated visitor, so reaching here means the session
  // resolved differently mid-render — send them to log in again.
  if (!user) redirect("/login");

  if (!effectiveCanSee(user.role, "inventory", user.grantedModules)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState
          title="No access"
          description="Your account doesn't have access to Inventory. Ask an owner to grant the Inventory module."
        />
      </div>
    );
  }

  const [stats, movements, usage, agentRuns] = await Promise.all([
    loadSection(getDashboardStats(supabase)),
    loadSection(getRecentMovements(supabase)),
    loadSection(getUsageByProject(supabase)),
    loadSection(getRecentAgentRuns(supabase)),
  ]);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-4">
        <h1 className="text-heading-sm font-normal text-snow">Inventory Dashboard</h1>
        <p className="text-[15px] text-smoke">Stock levels, movements and what the sourcing agent has been doing.</p>
      </div>

      <div className="mb-6 sm:mb-[26px]">
        <StatGrid stats={stats.data} error={stats.error} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr]">
        <RecentMovementsCard movements={movements.data} error={movements.error} />
        <div className="flex flex-col gap-4">
          <AgentActivityCard initialRuns={agentRuns.data} error={agentRuns.error} />
          <UsageByProjectCard bars={usage.data} error={usage.error} />
        </div>
      </div>
    </div>
  );
}
