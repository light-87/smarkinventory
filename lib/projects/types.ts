/**
 * lib/projects/types.ts — form input contracts for the Projects surface
 * (plan/tab-orders-projects.md · FEATURES.md §5.8).
 *
 * Every server action validates its payload against one of these zod schemas
 * before touching the DB (CLAUDE.md / OWNERSHIP.md convention).
 */

import { z } from "zod";
import { ActivityTypeSchema, PhaseRowKindSchema, zDateOnly, zUuid } from "@/types/db";

/** Projects list — "New project" card (name required, client optional). */
export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  client: z.string().trim().nullish(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

/** One row of the phase-timeline editor (R2-30). `id` absent = new row. */
export const PhaseInputSchema = z.object({
  id: zUuid.optional(),
  name: z.string().trim().min(1, "Phase name is required"),
  start_date: zDateOnly.nullish(),
  end_date: zDateOnly.nullish(),
  duration_text: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
  row_kind: PhaseRowKindSchema,
});
export type PhaseInput = z.infer<typeof PhaseInputSchema>;

/** Reorder payload — the full ordered id list after a drag/move. */
export const ReorderPhasesInputSchema = z.object({
  projectId: zUuid,
  orderedIds: z.array(zUuid).min(1),
});
export type ReorderPhasesInput = z.infer<typeof ReorderPhasesInputSchema>;

/** Notes & tasks feed entry (R2-06). */
export const ActivityInputSchema = z.object({
  projectId: zUuid,
  type: ActivityTypeSchema,
  title: z.string().trim().nullish(),
  body: z.string().trim().nullish(),
  taskAssignee: zUuid.nullish(),
  taskDue: zDateOnly.nullish(),
  sharedToPortal: z.boolean().default(false),
});
export type ActivityInput = z.infer<typeof ActivityInputSchema>;

/** Manual hour entry (R2-04, Q-03 final: manual only). */
export const TimeEntryInputSchema = z.object({
  projectId: zUuid,
  userId: zUuid,
  workDate: zDateOnly,
  hours: z.coerce.number().positive().max(24, "24 hours is the max for one day"),
  note: z.string().trim().nullish(),
});
export type TimeEntryInput = z.infer<typeof TimeEntryInputSchema>;
