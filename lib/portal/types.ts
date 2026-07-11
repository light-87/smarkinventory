/**
 * lib/portal/types.ts — zod schemas for the two portal RPC payloads
 * (`portal_get_project` / `portal_get_shared`, supabase/migrations/
 * 0006_portal_fns.sql).
 *
 * These are NOT part of `types/db.ts` (integrator-owned — the portal RPC
 * functions aren't tables and aren't in that contract, see
 * `lib/portal/anon-client.ts`'s header) but `row_kind`/`status` reuse the
 * SAME enums `types/db.ts` already declares for `smark_project_phases`, so
 * `PortalPhase` stays structurally interchangeable with `lib/projects/
 * phase-math.ts`'s `PhaseMathRow` (the portal renders phases through that
 * SAME pure function — see `lib/portal/phase-math.ts`).
 *
 * Parsing every RPC response through these schemas does double duty: normal
 * defensive validation, AND the portal's own leak guarantee — the schema IS
 * the whitelist. Every object schema below is `.strict()`, so an
 * accidentally-widened SQL payload (e.g. a future edit to 0006 that started
 * returning a price or a quantity) FAILS to parse instead of silently
 * reaching a component that might render it.
 */

import { z } from "zod";
import { PhaseRowKindSchema, PhaseStatusSchema } from "@/types/db";

export const PortalPhaseSchema = z
  .object({
    id: z.string(),
    sort_order: z.number(),
    name: z.string(),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    duration_text: z.string().nullable(),
    notes: z.string().nullable(),
    row_kind: PhaseRowKindSchema,
    status: PhaseStatusSchema,
    version_label: z.number(),
  })
  .strict();
export type PortalPhase = z.infer<typeof PortalPhaseSchema>;

export const PortalProjectStatusSchema = z.enum(["completed", "in_progress"]);
export type PortalProjectStatus = z.infer<typeof PortalProjectStatusSchema>;

/** `portal_get_project(p_token)` result — null when the RPC itself returned null. */
export const PortalProjectPayloadSchema = z
  .object({
    project_id: z.string(),
    name: z.string(),
    status: PortalProjectStatusSchema,
    est_start_date: z.string().nullable(),
    est_delivery_date: z.string().nullable(),
    timeline_note: z.string().nullable(),
    completed_at: z.string().nullable(),
    phases: z.array(PortalPhaseSchema),
  })
  .strict();
export type PortalProjectPayload = z.infer<typeof PortalProjectPayloadSchema>;

export const PortalActivityTypeSchema = z.enum(["note", "meeting", "change", "task"]);

export const PortalActivitySchema = z
  .object({
    id: z.string(),
    type: PortalActivityTypeSchema,
    title: z.string().nullable(),
    body: z.string().nullable(),
    from_portal: z.boolean(),
    created_at: z.string(),
  })
  .strict();
export type PortalActivity = z.infer<typeof PortalActivitySchema>;

export const PortalDocumentSchema = z
  .object({
    id: z.string(),
    display_name: z.string(),
    mime_type: z.string().nullable(),
    size_bytes: z.number().nullable(),
    file_url: z.string(),
    created_at: z.string(),
  })
  .strict();
export type PortalDocument = z.infer<typeof PortalDocumentSchema>;

/** `portal_get_shared(p_token)` result. */
export const PortalSharedPayloadSchema = z
  .object({
    activities: z.array(PortalActivitySchema),
    documents: z.array(PortalDocumentSchema),
  })
  .strict();
export type PortalSharedPayload = z.infer<typeof PortalSharedPayloadSchema>;

export const EMPTY_PORTAL_SHARED: PortalSharedPayload = { activities: [], documents: [] };

/**
 * `portal_get_pm(p_token)` result (supabase/migrations/0010_pm.sql) — the
 * client-facing project-management view: task list + progress. Same
 * `.strict()` whitelist rationale as the schemas above: an accidentally
 * widened RPC payload (e.g. a future edit that started returning a raw
 * `smark_time_logs` row) fails to parse instead of silently reaching a
 * component.
 */
export const PortalTaskStatusSchema = z.enum(["open", "awaiting_client_input", "submitted", "done"]);
export type PortalTaskStatus = z.infer<typeof PortalTaskStatusSchema>;

/**
 * `estimated_hours`/`actual_hours` are `null` whenever the owner's
 * `show_time_to_client` toggle is off (0010_pm.sql `portal_get_pm`) — NEVER
 * fabricate or assume a value when null; components must omit hours
 * entirely in that case rather than rendering "0h" or similar.
 */
export const PortalTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: PortalTaskStatusSchema,
    assignees: z.array(z.string()),
    estimated_hours: z.number().nullable(),
    actual_hours: z.number().nullable(),
  })
  .strict();
export type PortalTask = z.infer<typeof PortalTaskSchema>;

/** `portal_get_pm(p_token)` result — null when the RPC itself returned null (bad/archived token). */
export const PortalPmPayloadSchema = z
  .object({
    project_id: z.string(),
    name: z.string(),
    progress: z.number(),
    tasks: z.array(PortalTaskSchema),
  })
  .strict();
export type PortalPmPayload = z.infer<typeof PortalPmPayloadSchema>;

/**
 * `portal_get_requests(p_token)` (0014_portal_requests.sql) — the client's OWN
 * raised items (change requests + bug/issue reports) with their current status,
 * so the portal can show the client what happened to what they raised. `status`
 * is kept a plain string (union differs by `kind`: change → pending|accepted|
 * rejected · issue → open|confirmed|dismissed|resolved) — the component maps it.
 */
export const PortalRequestKindSchema = z.enum(["change", "issue"]);
export type PortalRequestKind = z.infer<typeof PortalRequestKindSchema>;

export const PortalRequestSchema = z
  .object({
    id: z.string(),
    kind: PortalRequestKindSchema,
    description: z.string(),
    status: z.string(),
    task_title: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();
export type PortalRequest = z.infer<typeof PortalRequestSchema>;

export const PortalRequestsPayloadSchema = z.object({ requests: z.array(PortalRequestSchema) }).strict();
export type PortalRequestsPayload = z.infer<typeof PortalRequestsPayloadSchema>;

export const EMPTY_PORTAL_REQUESTS: PortalRequestsPayload = { requests: [] };
