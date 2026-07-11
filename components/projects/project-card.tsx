import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { PmProjectView } from "@/lib/pm/queries";

/** Projects-list card: name · client · legacy/archived chips. */
export function ProjectCard({ project }: { project: PmProjectView }) {
  return (
    <Link href={`/projects/${project.id}`} className="block h-full">
      <Card
        interactive
        className={`flex h-full flex-col gap-4 border-l-[3px] ${
          project.archivedAt != null ? "border-l-slate" : "border-l-smark-orange"
        }`}
      >
        <div className="min-w-0">
          <div className="truncate text-[16px] text-snow">{project.name}</div>
          <div className="mt-0.5 truncate text-caption text-smoke">{project.client || "No client set"}</div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {project.importedAt != null && <Chip tone="neutral">Legacy import</Chip>}
          {project.archivedAt != null && <Chip tone="default">Archived</Chip>}
          {project.showTimeToClient && <Chip tone="accent">Hours shared</Chip>}
        </div>
      </Card>
    </Link>
  );
}
