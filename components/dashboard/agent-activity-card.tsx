import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Placeholder per this build's mission (plan/tab-dashboard.md describes the
 * fully-wired running/last-completed-run version, but that reads
 * `smark_agent_runs`, which WF-3 (bom-pipeline / worker) populates — not yet
 * built). Swap this for the real running/last cards once that lands.
 */
export function AgentActivityCard() {
  return (
    <Card>
      <div className="mb-4 text-[15px] font-medium text-snow">Agent activity</div>
      <EmptyState
        tone="subtle"
        title="No runs yet"
        description="Start a sourcing run from a project's BOM to see live agent progress here."
      />
    </Card>
  );
}
