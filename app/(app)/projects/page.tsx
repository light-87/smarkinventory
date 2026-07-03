import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const metadata: Metadata = { title: "Projects" };

// Placeholder — projects-hub owns app/(app)/projects/** (docs/OWNERSHIP.md).
export default function ProjectsPage() {
  return (
    <PlaceholderPage
      area="projects"
      title="Projects is on its way"
      description="Client jobs, named BOMs, phases and the ordering pipeline will live here."
    />
  );
}
