import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/format";
import type { ProjectListItem } from "@/lib/projects/queries";
import { ProjectStatusPill } from "./status-pill";

/** Projects-list card: name · client · derived status pill · BOM count · created date (R2-03). */
export function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <Link href={`/projects/${project.id}`} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] text-snow">{project.name}</div>
            <div className="mt-0.5 truncate text-caption text-smoke">{project.client || "No client set"}</div>
          </div>
          <ProjectStatusPill status={project.status} />
        </div>
        <div className="mt-auto flex items-center justify-between text-caption text-smoke">
          <span>
            {project.bomCount} {project.bomCount === 1 ? "BOM" : "BOMs"}
          </span>
          <span>{formatDate(project.created_at)}</span>
        </div>
        {project.archived_at != null && (
          <div>
            <Chip tone="neutral">Archived</Chip>
          </div>
        )}
      </Card>
    </Link>
  );
}
