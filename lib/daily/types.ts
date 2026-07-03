/**
 * lib/daily/types.ts — form/action input contracts for Daily Reports
 * (plan/tab-daily-reports.md R2-07, FEATURES.md §5.13).
 *
 * Every server action validates its payload against one of these zod schemas
 * before touching the DB (CLAUDE.md / OWNERSHIP.md convention) — the
 * `Database` generic on the Supabase client is not the validation layer.
 */

import { z } from "zod";
import { zDateOnly, zUuid } from "@/types/db";

/** Day-header person filter — "all" (owner/accountant) or a specific user id; employee is always forced to self server-side regardless of this value. */
export const PersonFilterSchema = z.union([z.literal("all"), zUuid]);
export type PersonFilter = z.infer<typeof PersonFilterSchema>;

/** Self clock-in — optional "working on" project tag set at the same time. */
export const ClockInInputSchema = z.object({
  projectId: zUuid.nullish(),
});
export type ClockInInput = z.infer<typeof ClockInInputSchema>;

/** Switch "working on" mid-day without clocking in/out again. */
export const SetWorkingOnInputSchema = z.object({
  projectId: zUuid.nullable(),
});
export type SetWorkingOnInput = z.infer<typeof SetWorkingOnInputSchema>;

/** Manual hours entry — self (userId must equal the caller) or owner correcting anyone's. */
export const LogHoursInputSchema = z.object({
  userId: zUuid,
  projectId: zUuid,
  workDate: zDateOnly,
  hours: z.coerce.number().positive("Hours must be greater than 0").max(24, "Can't log more than 24h in a day"),
  note: z.string().trim().max(500).nullish(),
});
export type LogHoursInput = z.infer<typeof LogHoursInputSchema>;

/** Edit an existing manual hours row (self's own, or owner's on anyone's). */
export const UpdateHoursInputSchema = z.object({
  id: zUuid,
  hours: z.coerce.number().positive("Hours must be greater than 0").max(24, "Can't log more than 24h in a day"),
  note: z.string().trim().max(500).nullish(),
});
export type UpdateHoursInput = z.infer<typeof UpdateHoursInputSchema>;

/**
 * Owner correcting/backfilling someone's attendance for a given day.
 * Times are `HH:mm` (24h) — combined with `workDate` server-side using the
 * app-server's local time zone, the same simplification the dashboard
 * package already made for "today" bounds (no project-wide IST convention
 * yet — see lib/daily/compute.ts `dateOnlyToIsoBounds`).
 */
export const OwnerSetAttendanceInputSchema = z.object({
  userId: zUuid,
  workDate: zDateOnly,
  checkInTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm")
    .nullish(),
  checkOutTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm")
    .nullish(),
  projectId: zUuid.nullable().optional(),
  note: z.string().trim().max(500).nullish(),
});
export type OwnerSetAttendanceInput = z.infer<typeof OwnerSetAttendanceInputSchema>;

/** Day/range export — GET query on `/daily/export`. */
export const ExportFormatSchema = z.enum(["csv", "xlsx"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportQuerySchema = z.object({
  from: zDateOnly,
  to: zDateOnly,
  format: ExportFormatSchema,
  person: PersonFilterSchema.default("all"),
});
export type ExportQuery = z.infer<typeof ExportQuerySchema>;
