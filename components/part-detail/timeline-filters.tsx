"use client";

import { Chip } from "@/components/ui/chip";
import { TIMELINE_EVENT_LABEL } from "@/lib/part-events/timeline";
import type { TimelineFilterState } from "@/lib/part-events/types";
import type { PartEventType } from "@/types/db";

export interface TimelineFiltersProps {
  availableEventTypes: PartEventType[];
  availableProjects: { id: string; name: string }[];
  value: TimelineFilterState;
  onChange: (next: TimelineFilterState) => void;
}

/** Timeline gains filters (event type, project) — tab-part-detail.md R2-13: "2000-part histories stay readable". */
export function TimelineFilters({ availableEventTypes, availableProjects, value, onChange }: TimelineFiltersProps) {
  if (availableEventTypes.length <= 1 && availableProjects.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {availableEventTypes.map((type) => {
        const active = value.eventTypes.includes(type);
        return (
          <Chip
            key={type}
            tone={active ? "soft" : "default"}
            className="cursor-pointer"
            onClick={() =>
              onChange({
                ...value,
                eventTypes: active ? value.eventTypes.filter((t) => t !== type) : [...value.eventTypes, type],
              })
            }
          >
            {TIMELINE_EVENT_LABEL[type]}
          </Chip>
        );
      })}
      {availableProjects.length > 0 && (
        <select
          value={value.projectId ?? ""}
          onChange={(e) => onChange({ ...value, projectId: e.target.value || null })}
          aria-label="Filter timeline by project"
          className="h-[26px] rounded-full border border-charcoal bg-surface-well px-3 text-xs text-silver-mist outline-none focus:border-smark-orange"
        >
          <option value="">All projects</option>
          {availableProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
