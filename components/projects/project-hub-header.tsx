import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/format";
import type { ProjectRow } from "@/types/db";

/** Project-hub header: back link, name, client, archived/completed state. */
export function ProjectHubHeader({ project }: { project: ProjectRow }) {
  return (
    <div className="mb-4">
      <Link href="/projects" className="text-[13px] text-smoke transition-colors hover:text-snow">
        ← All projects
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-heading-sm font-normal text-snow">{project.name}</h1>
        {project.client && <span className="text-[13px] text-smoke">{project.client}</span>}
        {project.completed_at != null && <Chip tone="success">Completed {formatDate(project.completed_at)}</Chip>}
        {project.archived_at != null && <Chip tone="neutral">Archived</Chip>}
      </div>
    </div>
  );
}
