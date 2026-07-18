/**
 * lib/attendance/types.ts — form/action input contracts for the Attendance
 * module. Every server action (lib/attendance/actions.ts) validates its
 * payload against one of these zod schemas before touching the DB — mirrors
 * lib/daily/types.ts.
 */

import { z } from "zod";
import { zDateOnly, zUuid, HolidayKindSchema, LeaveReasonSchema } from "@/types/db";

/** Self mark-present for today — optional "working on" project tag, mirrors ClockInInputSchema. */
export const MarkPresentInputSchema = z.object({
  projectId: zUuid.nullish(),
});
export type MarkPresentInput = z.infer<typeof MarkPresentInputSchema>;

/** Employee claims they worked a holiday date. */
export const SubmitCompWorkInputSchema = z.object({
  workDate: zDateOnly,
  note: z.string().trim().max(500).nullish(),
});
export type SubmitCompWorkInput = z.infer<typeof SubmitCompWorkInputSchema>;

/** Owner approves/rejects a comp-work claim. */
export const DecideCompWorkInputSchema = z.object({
  id: zUuid,
  approve: z.boolean(),
});
export type DecideCompWorkInput = z.infer<typeof DecideCompWorkInputSchema>;

/** Employee submits a leave request. */
export const SubmitLeaveRequestInputSchema = z
  .object({
    startDate: zDateOnly,
    endDate: zDateOnly,
    reason: LeaveReasonSchema,
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date can't be before start date", path: ["endDate"] });
export type SubmitLeaveRequestInput = z.infer<typeof SubmitLeaveRequestInputSchema>;

/**
 * Owner approves/rejects a leave request. (0018) When APPROVING a
 * `compensatory` leave, `compHours` is the number of comp-off hours the owner
 * chooses to deduct from the employee's balance (ignored for reject / non-comp
 * leaves; the action defaults + caps it against the live balance).
 */
export const DecideLeaveRequestInputSchema = z.object({
  id: zUuid,
  approve: z.boolean(),
  compHours: z.number().min(0).max(999).nullish(),
});
export type DecideLeaveRequestInput = z.infer<typeof DecideLeaveRequestInputSchema>;

/** (0018) Employee reports extra hours worked on a date. */
export const SubmitOvertimeInputSchema = z.object({
  workDate: zDateOnly,
  hours: z.number().positive("Enter hours worked").max(24, "At most 24 hours"),
  note: z.string().trim().max(500).nullish(),
});
export type SubmitOvertimeInput = z.infer<typeof SubmitOvertimeInputSchema>;

/** (0018) Owner approves (with optional adjusted hours) / rejects an overtime claim. */
export const DecideOvertimeInputSchema = z.object({
  id: zUuid,
  approve: z.boolean(),
  hoursApproved: z.number().min(0).max(24).nullish(),
});
export type DecideOvertimeInput = z.infer<typeof DecideOvertimeInputSchema>;

/** Owner adds a specific-date holiday. */
export const AddHolidayInputSchema = z.object({
  holidayDate: zDateOnly,
  name: z.string().trim().min(1, "Name is required").max(120),
});
export type AddHolidayInput = z.infer<typeof AddHolidayInputSchema>;

/** Owner removes a holiday (specific date or a weekly-off day) by row id. */
export const RemoveHolidayInputSchema = z.object({
  id: zUuid,
});
export type RemoveHolidayInput = z.infer<typeof RemoveHolidayInputSchema>;

/** Owner sets (adds, if not already set) a weekly-off weekday. */
export const SetWeeklyOffInputSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  name: z.string().trim().min(1).max(120).default("Weekly off"),
});
export type SetWeeklyOffInput = z.infer<typeof SetWeeklyOffInputSchema>;

/** Owner day-correction — reuses the shape of lib/daily's OwnerSetAttendanceInput (HH:mm times). */
export const OwnerCorrectAttendanceInputSchema = z.object({
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
  note: z.string().trim().max(500).nullish(),
});
export type OwnerCorrectAttendanceInput = z.infer<typeof OwnerCorrectAttendanceInputSchema>;

export { HolidayKindSchema, LeaveReasonSchema };
