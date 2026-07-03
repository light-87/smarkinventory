import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats, getRecentMovements, getUsageByProject } from "@/lib/dashboard/queries";
import { StatGrid } from "@/components/dashboard/stat-grid";
import { RecentMovementsCard } from "@/components/dashboard/recent-movements-card";
import { AgentActivityCard } from "@/components/dashboard/agent-activity-card";
import { UsageByProjectCard } from "@/components/dashboard/usage-by-project-card";

export const metadata: Metadata = { title: "Dashboard" };

interface Section<T> {
  data: T | null;
  error: string | null;
}

/** Each dashboard section fails independently — one bad query never blanks the whole page. */
async function loadSection<T>(promise: Promise<T>): Promise<Section<T>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [stats, movements, usage] = await Promise.all([
    loadSection(getDashboardStats(supabase)),
    loadSection(getRecentMovements(supabase)),
    loadSection(getUsageByProject(supabase)),
  ]);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-24 sm:px-6 sm:pt-7">
      <div className="mb-6 sm:mb-[26px]">
        <StatGrid stats={stats.data} error={stats.error} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr]">
        <RecentMovementsCard movements={movements.data} error={movements.error} />
        <div className="flex flex-col gap-4">
          <AgentActivityCard />
          <UsageByProjectCard bars={usage.data} error={usage.error} />
        </div>
      </div>
    </div>
  );
}
