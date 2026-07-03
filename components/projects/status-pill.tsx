import { Chip, type ChipTone } from "@/components/ui/chip";
import type { ProjectStatus } from "@/types/db";

const LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  sourcing: "Sourcing",
  sourced: "Sourced",
};

const TONE: Record<ProjectStatus, ChipTone> = {
  draft: "neutral",
  sourcing: "accent",
  sourced: "success",
};

/** Derived project-card status pill [R2-03] — draft / sourcing / sourced. */
export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  return <Chip tone={TONE[status]}>{LABEL[status]}</Chip>;
}
