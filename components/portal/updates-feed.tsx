import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeTime } from "@/lib/format";
import type { PortalActivity } from "@/lib/portal/types";

const TYPE_LABEL: Record<PortalActivity["type"], string> = {
  note: "Note",
  meeting: "Meeting",
  change: "Update",
  task: "Task",
};

/** Owner-curated feed — explicitly `shared_to_portal` activities only (default OFF, FEATURES §11). */
export function UpdatesFeed({ activities }: { activities: PortalActivity[] }) {
  if (activities.length === 0) {
    return (
      <EmptyState
        tone="subtle"
        title="No updates yet"
        description="Updates Smark shares with you will show up here."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {activities.map((activity) => (
        <li key={activity.id} className="rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={activity.from_portal ? "accent" : "default"} size="sm">
                {activity.from_portal ? "You" : TYPE_LABEL[activity.type]}
              </Chip>
              {activity.title && (
                <span className="text-[14px] font-medium text-snow">{activity.title}</span>
              )}
            </div>
            <span className="flex-none text-caption text-smoke">{formatRelativeTime(activity.created_at)}</span>
          </div>
          {activity.body && (
            <p className="mt-1.5 text-body-sm whitespace-pre-wrap text-silver-mist">{activity.body}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
