import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import type { PmProjectView } from "@/lib/pm/queries";

/** Project-hub header: back link, name, client, legacy/archived state. */
export function ProjectHubHeader({ project }: { project: PmProjectView }) {
  return (
    <div className="mb-4">
      <Link href="/projects" className="text-[13px] text-smoke transition-colors hover:text-snow">
        ← All projects
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-heading-sm font-normal text-snow">{project.name}</h1>
        {project.client && <span className="text-[13px] text-smoke">{project.client}</span>}
        {project.importedAt != null && <Chip tone="neutral">Legacy import</Chip>}
        {project.archivedAt != null && <Chip tone="default">Archived</Chip>}
      </div>
    </div>
  );
}
