/**
 * types/db.ts — SmarkStock shared DB contracts.
 *
 * Mirrors `plan/SCHEMA.md` §0–8 (canonical). Every table gets:
 *   - a zod row schema (`XRowSchema`) — validates rows as returned by PostgREST
 *   - an inferred TS type (`XRow`)
 * plus enums for every status/role/kind, typed jsonb payloads, view row contracts,
 * and the `Database` generic consumed by the Supabase clients in `lib/supabase/*`.
 *
 * Conventions (SCHEMA.md header): `smark_` prefix, uuid PK `id`,
 * `created_at timestamptz default now()`, `updated_at timestamptz` (nullable),
 * actor columns FK → `smark_app_users.id` (nullable where the system writes rows).
 *
 * Deviations from SCHEMA.md §0–8 (all sourced from FEATURES.md, noted inline):
 *   - `smark_project_activities.shared_to_portal` (FEATURES §13 "portal-share flag")
 *   - `smark_project_activities.from_portal` + nullable `created_by`
 *     (FEATURES §17: portal comments land as `change` activities "from client portal")
 *   - `smark_project_documents.shared_to_portal` (FEATURES §17: "explicitly shared
 *     updates/documents only")
 */

import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Scalar helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** uuid column */
export const zUuid = z.uuid();
/** timestamptz column — ISO 8601 with offset, as PostgREST returns it */
export const zTimestamptz = z.iso.datetime({ offset: true });
/** date column — `YYYY-MM-DD` */
export const zDateOnly = z.iso.date();

/** Columns every table carries (SCHEMA.md conventions). */
const baseRow = {
  id: zUuid,
  created_at: zTimestamptz,
  updated_at: zTimestamptz.nullable(),
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Enums (CHECK-constrained text columns in the DB)
 * ──────────────────────────────────────────────────────────────────────────── */

/** §0 `smark_app_users.role` — Q-01 FINAL. */
export const AppRoleSchema = z.enum(["owner", "employee", "accountant"]);
export type AppRole = z.infer<typeof AppRoleSchema>;

/** §1 `smark_parts.part_status` (also distributor-reported status on results). */
export const PartStatusSchema = z.enum(["active", "nrnd", "eol"]);
export type PartStatus = z.infer<typeof PartStatusSchema>;

/**
 * §1 `smark_parts.category` is an OPEN typed facet ("Capacitor / Resistor / IC /
 * Module / SMPS / Connector / Inductor…"). Column stays `text`; this list is the
 * known starter set for chips/facets, not a constraint.
 */
export const PART_CATEGORIES = [
  "Capacitor",
  "Resistor",
  "IC",
  "Module",
  "SMPS",
  "Connector",
  "Inductor",
  "Diode",
  "Transistor",
  "LED",
  "Crystal",
  "Switch",
  "Fuse",
  "Relay",
  "Other",
] as const;

/**
 * §1 project card status [R2-03] — DERIVED from the project's BOMs'
 * `sourcing_status` + active runs. NOT a column on `smark_projects` (0003
 * stores no cached value); compute it app-side. This enum is the contract for
 * that derived value.
 */
export const ProjectStatusSchema = z.enum(["draft", "sourcing", "sourced"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** §1 `smark_project_phases.row_kind` [R2-30]. */
export const PhaseRowKindSchema = z.enum(["phase", "parallel", "buffer", "footnote"]);
export type PhaseRowKind = z.infer<typeof PhaseRowKindSchema>;

/** §1 `smark_project_phases.status` — exactly one `active` per project (Q-07). */
export const PhaseStatusSchema = z.enum(["pending", "active", "done"]);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

/** §1 `smark_distributors.api_type`. */
export const DistributorApiTypeSchema = z.enum(["rest", "browse", "none"]);
export type DistributorApiType = z.infer<typeof DistributorApiTypeSchema>;

/** §3 `smark_boms.sourcing_status` [R2-03]. */
export const BomSourcingStatusSchema = z.enum(["draft", "sourced", "ordered"]);
export type BomSourcingStatus = z.infer<typeof BomSourcingStatusSchema>;

/** §3 `smark_bom_lines.match_state`. */
export const BomLineMatchStateSchema = z.enum(["in_stock", "to_order", "unresolved"]);
export type BomLineMatchState = z.infer<typeof BomLineMatchStateSchema>;

/** §4 `smark_order_jobs.status` — claimed atomically (FOR UPDATE SKIP LOCKED). */
export const OrderJobStatusSchema = z.enum(["queued", "claimed", "done", "failed"]);
export type OrderJobStatus = z.infer<typeof OrderJobStatusSchema>;

/** §4 `smark_agent_runs.status`. */
export const AgentRunStatusSchema = z.enum(["planning", "running", "review", "done", "failed"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

/** §4 `smark_agent_runs.concurrency_preset` (FEATURES §5.9 Economy/Balanced/Thorough). */
export const ConcurrencyPresetSchema = z.enum(["economy", "balanced", "thorough"]);
export type ConcurrencyPreset = z.infer<typeof ConcurrencyPresetSchema>;

/** §4 `smark_agent_results.mpn_match`. */
export const MpnMatchSchema = z.enum(["exact", "approx", "none"]);
export type MpnMatch = z.infer<typeof MpnMatchSchema>;

/** §4 `smark_cart_items.source` [R2-09]. */
export const CartItemSourceSchema = z.enum(["review_add", "auto_shortfall", "manual"]);
export type CartItemSource = z.infer<typeof CartItemSourceSchema>;

/** §4 `smark_cart_items.status` — `dismissed` applies to auto lines only (Q-05). */
export const CartItemStatusSchema = z.enum(["open", "dismissed", "ordered"]);
export type CartItemStatus = z.infer<typeof CartItemStatusSchema>;

/** §4 `smark_orders.status` — statuses only walk forward (A3 invariant). */
export const OrderStatusSchema = z.enum(["ordered", "partially_arrived", "arrived"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** §4 `smark_order_lines.line_status`. */
export const OrderLineStatusSchema = z.enum(["ordered", "arrived"]);
export type OrderLineStatus = z.infer<typeof OrderLineStatusSchema>;

/** §5 `smark_agent_feedback.feedback_tag`. */
export const FeedbackTagSchema = z.enum([
  "wrong_package",
  "prefer_distributor",
  "already_stocked",
  "price_wrong",
  "other",
]);
export type FeedbackTag = z.infer<typeof FeedbackTagSchema>;

/** §5 `smark_learned_rules.scope`. */
export const LearnedRuleScopeSchema = z.enum([
  "global",
  "category",
  "part",
  "project",
  "distributor",
]);
export type LearnedRuleScope = z.infer<typeof LearnedRuleScopeSchema>;

/** §5 `smark_learned_rules.rule_type`. */
export const LearnedRuleTypeSchema = z.enum([
  "prefer_distributor",
  "avoid_distributor",
  "already_stocked",
  "package_correction",
  "status_preference",
  "price_source_note",
]);
export type LearnedRuleType = z.infer<typeof LearnedRuleTypeSchema>;

/** §5 `smark_learned_rules.status` — suggested NEVER auto-activates (A3 invariant). */
export const LearnedRuleStatusSchema = z.enum(["suggested", "active", "retired"]);
export type LearnedRuleStatus = z.infer<typeof LearnedRuleStatusSchema>;

/** §5 `smark_ordering_rules.key` — the standard search ladder (FEATURES §7). */
export const OrderingRuleKeySchema = z.enum([
  "mpn",
  "lcsc",
  "value",
  "package",
  "status",
  "qty",
  "cost",
  "custom",
]);
export type OrderingRuleKey = z.infer<typeof OrderingRuleKeySchema>;

/** §6 `smark_part_events.event_type` — enriched per [R2-13]. */
export const PartEventTypeSchema = z.enum([
  "ordered",
  "received",
  "adjusted",
  "note",
  "picked",
  "price_change",
  "location_moved",
]);
export type PartEventType = z.infer<typeof PartEventTypeSchema>;

/** §6 `smark_movements.reason`. */
export const MovementReasonSchema = z.enum(["pick", "receive", "adjust", "bulk_pick", "undo"]);
export type MovementReason = z.infer<typeof MovementReasonSchema>;

/**
 * §6 `smark_movements.reason_detail` — nullable qualifier on `reason`.
 * `"audit"` tags a guided box-audit variance (FEATURES.md §5.4/§9); the DB
 * additionally pins the tag to `reason = "adjust"`. Null on every other movement.
 */
export const MovementReasonDetailSchema = z.enum(["audit"]);
export type MovementReasonDetail = z.infer<typeof MovementReasonDetailSchema>;

/** §6 `smark_qr_labels.target_type`. */
export const QrTargetTypeSchema = z.enum(["part", "big_box"]);
export type QrTargetType = z.infer<typeof QrTargetTypeSchema>;

/** §6/§7 `smark_qr_labels.print_status` [R2-35]. */
export const PrintStatusSchema = z.enum(["queued", "printed"]);
export type PrintStatus = z.infer<typeof PrintStatusSchema>;

/** §7 `smark_project_activities.type` [R2-06]. */
export const ActivityTypeSchema = z.enum(["note", "meeting", "change", "task"]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/** §7 `smark_ai_aliases.entity_type` [R2-17]. */
export const AliasEntityTypeSchema = z.enum(["client", "project", "product", "custom"]);
export type AliasEntityType = z.infer<typeof AliasEntityTypeSchema>;

/** §7 `smark_expenses.entry_type` [R2-20]. */
export const ExpenseEntryTypeSchema = z.enum(["expense", "income"]);
export type ExpenseEntryType = z.infer<typeof ExpenseEntryTypeSchema>;

/** §7 `smark_expenses.category` — Q-09 FINAL list. */
export const ExpenseCategorySchema = z.enum([
  "Materials",
  "Salaries",
  "Rent",
  "Utilities",
  "Tools",
  "Client payment",
  "Other",
]);
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

/** §7 `smark_expense_accounts.account_type` [R2-28]. */
export const ExpenseAccountTypeSchema = z.enum(["cash", "bank", "upi"]);
export type ExpenseAccountType = z.infer<typeof ExpenseAccountTypeSchema>;

/** §7 `smark_part_field_templates.field_type` [R2-23] (also BOM template columns). */
export const FieldTypeSchema = z.enum(["text", "number"]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/**
 * §7 `smark_notifications.kind` [R2-36] — extended (0009) with the attendance
 * module's four kinds, and (0010) with the PM module's three kinds.
 */
export const NotificationKindSchema = z.enum([
  "arrival",
  "task_assigned",
  "rule_pending",
  "low_stock",
  "run_done",
  "expense_draft",
  "portal_comment",
  "comp_pending",
  "leave_pending",
  "comp_decided",
  "leave_decided",
  "bug_reported",
  "change_requested",
  "client_input_provided",
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** (0009) `smark_holidays.kind`. */
export const HolidayKindSchema = z.enum(["specific", "weekly_off"]);
export type HolidayKind = z.infer<typeof HolidayKindSchema>;

/** (0009) `smark_leave_requests.reason`. */
export const LeaveReasonSchema = z.enum(["personal", "sick", "compensatory"]);
export type LeaveReason = z.infer<typeof LeaveReasonSchema>;

/** (0009) `smark_leave_requests.status` / `smark_comp_work.status` — shared approval lifecycle. */
export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/** (0010) `smark_tasks.status`. */
export const TaskStatusSchema = z.enum(["open", "awaiting_client_input", "submitted", "done"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** (0010) `smark_tasks.source`. */
export const TaskSourceSchema = z.enum(["manual", "change_request"]);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

/** (0010) `smark_bugs.classification` — only `bug` + `confirmed` counts toward effectiveness. */
export const BugClassificationSchema = z.enum(["bug", "change_request"]);
export type BugClassification = z.infer<typeof BugClassificationSchema>;

/** (0010) `smark_bugs.status` — owner-triaged lifecycle. */
export const BugStatusSchema = z.enum(["open", "confirmed", "dismissed", "resolved"]);
export type BugStatus = z.infer<typeof BugStatusSchema>;

/** (0010) `smark_bugs.reported_source`. */
export const ReportedSourceSchema = z.enum(["client", "owner", "engineer"]);
export type ReportedSource = z.infer<typeof ReportedSourceSchema>;

/** (0010) `smark_change_requests.status`. */
export const ChangeRequestStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;

/** (0010) `smark_change_requests.requested_source`. */
export const RequestedSourceSchema = z.enum(["client", "owner"]);
export type RequestedSource = z.infer<typeof RequestedSourceSchema>;

/** (0010) `smark_task_holds.ended_source`. */
export const HoldEndedSourceSchema = z.enum(["client", "owner"]);
export type HoldEndedSource = z.infer<typeof HoldEndedSourceSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Typed jsonb payloads
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_parts.attributes` — long-tail scalar specs (tolerance, dielectric, wattage…). */
export const PartAttributesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type PartAttributes = z.infer<typeof PartAttributesSchema>;

/** One entry of `smark_boms.distributor_sequence` — ordered, toggleable. */
export const DistributorSequenceItemSchema = z.object({
  distributor_id: zUuid,
  enabled: z.boolean(),
});
export type DistributorSequenceItem = z.infer<typeof DistributorSequenceItemSchema>;

/** `smark_bom_templates.columns` entry [R2-19] — `[{key,label,type,required,is_custom}]`. */
export const BomTemplateColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: FieldTypeSchema,
  required: z.boolean(),
  is_custom: z.boolean(),
});
export type BomTemplateColumn = z.infer<typeof BomTemplateColumnSchema>;

/** `smark_bom_lines.extra` — custom-column values from the in-app builder [R2-19]. */
export const BomLineExtraSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type BomLineExtra = z.infer<typeof BomLineExtraSchema>;

/** `smark_agent_results.qty_breaks` entry. */
export const QtyBreakSchema = z.object({
  qty: z.number(),
  unit_price: z.number(),
});
export type QtyBreak = z.infer<typeof QtyBreakSchema>;

/**
 * One slice of `smark_cart_items.demand` [R2-09/10] — per-project breakdown
 * `[{project_id, bom_id, bom_line_id, qty}]`. Manual adds carry `[]`.
 */
export const CartDemandSliceSchema = z.object({
  project_id: zUuid,
  bom_id: zUuid,
  bom_line_id: zUuid,
  qty: z.number().int(),
});
export type CartDemandSlice = z.infer<typeof CartDemandSliceSchema>;

/** `smark_cart_items.descriptor` — carries mpn/value/pkg when `part_id` is null. */
export const CartDescriptorSchema = z.object({
  mpn: z.string().nullish(),
  lcsc_pn: z.string().nullish(),
  value: z.string().nullish(),
  package: z.string().nullish(),
  voltage: z.string().nullish(),
  description: z.string().nullish(),
});
export type CartDescriptor = z.infer<typeof CartDescriptorSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §0 Users & auth [R2-01]
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_app_users` — profile row per login; `id` = `auth.users.id`. */
export const AppUserRowSchema = z.object({
  ...baseRow,
  /** Login handle shown in UI; maps to synthetic email `{username}@smark.internal`. */
  username: z.string(),
  display_name: z.string().nullable(),
  role: AppRoleSchema,
  /** Deactivate blocks login; never hard-delete (history FKs). */
  active: z.boolean(),
  /** The owner who added them; null for the bootstrap owner. */
  created_by: zUuid.nullable(),
  /** (0009) Optional DOB — birthday surfacing; nullable, no back-fill required. */
  birth_date: zDateOnly.nullable(),
  /** (0011) Onboarding-collected DOJ; nullable. Non-sensitive — kept on the profile row. */
  date_of_joining: zDateOnly.nullable(),
  /** (0011) Non-null once first-login onboarding (DOB + DOJ + bank details) is complete. */
  onboarded_at: zTimestamptz.nullable(),
});
export type AppUserRow = z.infer<typeof AppUserRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * (0011) Employee onboarding + documents
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * (0011) `smark_employee_private` — SENSITIVE PII (PAN + bank details),
 * ONE row per user (`user_id` is the PK, = `smark_app_users.id`). Deliberately
 * NOT on `smark_app_users` (whose SELECT policy is `using(true)`, readable by
 * every authed user): this table's RLS gates EVERY verb to self-or-owner-or-
 * accountant, so a direct client query by another employee returns zero rows.
 * Never log these values (see lib/employees/*, lib/onboarding/* headers).
 */
export const EmployeePrivateRowSchema = z.object({
  user_id: zUuid,
  pan_number: z.string().nullable(),
  bank_account_name: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  bank_ifsc: z.string().nullable(),
  bank_name: z.string().nullable(),
  created_at: zTimestamptz,
  updated_at: zTimestamptz.nullable(),
});
export type EmployeePrivateRow = z.infer<typeof EmployeePrivateRowSchema>;

/** (0011) `smark_employee_documents.doc_type`. */
export const EmployeeDocTypeSchema = z.enum(["nda", "aadhaar", "pan_card", "nda_client", "other"]);
export type EmployeeDocType = z.infer<typeof EmployeeDocTypeSchema>;

/** `smark_employee_documents` — employee-uploaded docs; `file_url` is a StoragePort key, not a public URL. */
export const EmployeeDocumentRowSchema = z.object({
  ...baseRow,
  user_id: zUuid,
  doc_type: EmployeeDocTypeSchema,
  client_label: z.string().nullable(),
  display_name: z.string(),
  file_url: z.string(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().nullable(),
  uploaded_by: zUuid.nullable(),
});
export type EmployeeDocumentRow = z.infer<typeof EmployeeDocumentRowSchema>;

/**
 * (0013) Grantable module bundles — Settings → Users → module permissions
 * (lib/rbac/*). `project_dashboard` is deliberately NOT part of
 * `project_management` — it stays owner-only always, never grantable
 * (lib/rbac/types.ts MODULE_AREAS is the app-side twin of this list).
 */
export const ModuleSchema = z.enum(["inventory", "project_management", "attendance"]);
export type Module = z.infer<typeof ModuleSchema>;

/** `smark_user_module_grants` — one row per (user, module) grant. */
export const ModuleGrantRowSchema = z.object({
  id: zUuid,
  user_id: zUuid,
  module: ModuleSchema,
  granted_by: zUuid.nullable(),
  created_at: zTimestamptz,
});
export type ModuleGrantRow = z.infer<typeof ModuleGrantRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §1 Catalog & reference
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_parts`. */
export const PartRowSchema = z.object({
  ...baseRow,
  /** Short QR value, e.g. `SMK-000482`; unique. */
  internal_pid: z.string(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  lcsc_pn: z.string().nullable(),
  description: z.string().nullable(),
  /** Open typed facet — see PART_CATEGORIES. Nullable (messy-import rows land uncategorized). */
  category: z.string().nullable(),
  value: z.string().nullable(),
  /** Participates in the MANDATORY package match (ladder rung 4). */
  package: z.string().nullable(),
  /** [R2-24] split out of combined value strings (`0.1µF/50V` → `0.1µF` + `50V`). */
  voltage: z.string().nullable(),
  part_status: PartStatusSchema,
  datasheet_url: z.string().nullable(),
  default_distributor: z.string().nullable(),
  /** GIN-indexed long-tail specs + remembered custom-field values [R2-23]. */
  attributes: PartAttributesSchema,
  /** Denormalized rollup over `smark_stock_locations.qty` (A3 invariant). */
  total_qty: z.number().int(),
  /** Low-stock threshold per part. */
  reorder_point: z.number().int().nullable(),
  /** Import provenance (Stock List sheet name). */
  source_sheet: z.string().nullable(),
  /** Onboarding / dedupe flag. */
  needs_review: z.boolean(),
  /** [R2-11] ₹ — stamped on arrival (order line / receipt extraction). */
  last_unit_price: z.number().nullable(),
  /** [R2-11] default `INR`. */
  currency: z.string(),
  created_by: zUuid.nullable(),
});
export type PartRow = z.infer<typeof PartRowSchema>;

/** `smark_distributors` — addable via Settings [R2-28]. */
export const DistributorRowSchema = z.object({
  ...baseRow,
  name: z.string(),
  api_type: DistributorApiTypeSchema,
  base_url: z.string().nullable(),
  default_region: z.string().nullable(),
  active: z.boolean(),
  created_by: zUuid.nullable(),
});
export type DistributorRow = z.infer<typeof DistributorRowSchema>;

/** `smark_projects`. */
export const ProjectRowSchema = z.object({
  ...baseRow,
  name: z.string(),
  code: z.string().nullable(),
  notes: z.string().nullable(),
  /** Owner label for the client. */
  client: z.string().nullable(),
  // NOTE [R2-03]: card status (draft/sourcing/sourced) is DERIVED, not a column
  // — see ProjectStatusSchema above. 0003 stores no cached value.
  /** [R2-05] minimal timeline columns. */
  est_start_date: zDateOnly.nullable(),
  est_delivery_date: zDateOnly.nullable(),
  timeline_note: z.string().nullable(),
  /** [R2-14 · Q-07] stamped when last phase done + owner confirms. */
  completed_at: zDateOnly.nullable(),
  /** [R2-30] client-portal capability token; regenerate = revoke. */
  share_token: z.string().nullable(),
  /** [R2-32] archive releases demand, freezes activity, suspends portal. */
  archived_at: zTimestamptz.nullable(),
  created_by: zUuid.nullable(),
  /** (0010) owner toggle — portal_get_pm() includes task hours only when true. */
  show_time_to_client: z.boolean(),
  /** (0010) non-null = created by scripts/import-clockify.ts (legacy project, no KPI). */
  imported_at: zTimestamptz.nullable(),
  /** (0012) owner-entered client contact for reminder emails — the client has no account. */
  client_email: z.string().nullable(),
});
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

/** `smark_project_phases` [R2-30] — the estimate-sheet timeline. */
export const ProjectPhaseRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  sort_order: z.number().int(),
  name: z.string(),
  /** Nullable — parallel/footnote rows have no dates. */
  start_date: zDateOnly.nullable(),
  end_date: zDateOnly.nullable(),
  /** Free text — "9-10 days", "Running parallel with design". */
  duration_text: z.string().nullable(),
  notes: z.string().nullable(),
  row_kind: PhaseRowKindSchema,
  status: PhaseStatusSchema,
  /** Small `v` counter bumped on date edits (rendered `v{N}`). */
  version_label: z.number().int(),
  created_by: zUuid.nullable(),
});
export type ProjectPhaseRow = z.infer<typeof ProjectPhaseRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §2 Physical location — Shelf → Big Box → ESD plastic
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_shelves`. */
export const ShelfRowSchema = z.object({
  ...baseRow,
  /** `A`, `B`, … */
  code: z.string(),
  name: z.string().nullable(),
  location_note: z.string().nullable(),
  created_by: zUuid.nullable(),
});
export type ShelfRow = z.infer<typeof ShelfRowSchema>;

/** `smark_big_boxes`. */
export const BigBoxRowSchema = z.object({
  ...baseRow,
  shelf_id: zUuid,
  name: z.string(),
  /** Drives the AI storage suggestion on Receive. */
  category: z.string().nullable(),
  notes: z.string().nullable(),
  qr_label_id: zUuid.nullable(),
  created_by: zUuid.nullable(),
});
export type BigBoxRow = z.infer<typeof BigBoxRowSchema>;

/** `smark_stock_locations` — the ESD plastic. One home per part normally; a second
 * row allowed for the bulk (reel + working box) case. */
export const StockLocationRowSchema = z.object({
  ...baseRow,
  part_id: zUuid,
  big_box_id: zUuid,
  qty: z.number().int(),
  esd_note: z.string().nullable(),
  /** Stamped by guided box audits. */
  last_counted_at: zTimestamptz.nullable(),
  created_by: zUuid.nullable(),
});
export type StockLocationRow = z.infer<typeof StockLocationRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §3 BOMs & reconciliation
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_boms` — many per project; `UNIQUE(project_id, name)` [R2-03]. */
export const BomRowSchema = z.object({
  ...baseRow,
  /** User-given label ("Mainboard v1.2") — required + unique per project. */
  name: z.string(),
  project_id: zUuid,
  /** R2 file; null for BOMs created in-app [R2-19]. */
  source_file_url: z.string().nullable(),
  uploaded_by: zUuid.nullable(),
  line_count: z.number().int(),
  /** Ordered per-BOM distributor sequence (null → global default). */
  distributor_sequence: z.array(DistributorSequenceItemSchema).nullable(),
  /** Overall plain-English priorities (from template cell / workspace). */
  priority_notes: z.string().nullable(),
  sourcing_status: BomSourcingStatusSchema,
  saved_run_id: zUuid.nullable(),
  /** [R2-19] built with the grid editor vs uploaded file. */
  created_in_app: z.boolean(),
  /** [R2-27] every need = line qty × build_qty; change flags the saved run stale. */
  build_qty: z.number().int(),
  /** [0015] Soft-archive timestamp — non-null hides the BOM + releases its demand; reversible. */
  archived_at: zTimestamptz.nullable(),
});
export type BomRow = z.infer<typeof BomRowSchema>;

/** `smark_bom_templates` [R2-19] — the ONE remembered company Create-BOM structure. */
export const BomTemplateRowSchema = z.object({
  ...baseRow,
  columns: z.array(BomTemplateColumnSchema),
  created_by: zUuid.nullable(),
  last_used_at: zTimestamptz.nullable(),
});
export type BomTemplateRow = z.infer<typeof BomTemplateRowSchema>;

/** `smark_bom_lines`. */
export const BomLineRowSchema = z.object({
  ...baseRow,
  bom_id: zUuid,
  line_no: z.number().int().nullable(),
  /** Raw reference designators, `C3,C69…`. */
  references: z.string().nullable(),
  qty: z.number().int().nullable(),
  value: z.string().nullable(),
  /** Raw footprint string from the sheet. */
  footprint: z.string().nullable(),
  dnp: z.boolean(),
  description: z.string().nullable(),
  mpn: z.string().nullable(),
  manufacturer: z.string().nullable(),
  part_link: z.string().nullable(),
  lcsc_pn: z.string().nullable(),
  priority_note: z.string().nullable(),
  matched_part_id: zUuid.nullable(),
  match_state: BomLineMatchStateSchema,
  /** 0–100, from lib/matcher. */
  match_confidence: z.number().nullable(),
  /** [R2-19] custom-column values from the in-app builder. */
  extra: BomLineExtraSchema.nullable(),
});
export type BomLineRow = z.infer<typeof BomLineRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §4 Ordering — runs, results, cart, orders
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_order_jobs` — worker queue; claimed atomically. */
export const OrderJobRowSchema = z.object({
  ...baseRow,
  run_id: zUuid,
  bom_line_id: zUuid,
  plan: z.unknown().nullable(),
  status: OrderJobStatusSchema,
  claimed_at: zTimestamptz.nullable(),
  attempts: z.number().int(),
});
export type OrderJobRow = z.infer<typeof OrderJobRowSchema>;

/** `smark_agent_runs`. */
export const AgentRunRowSchema = z.object({
  ...baseRow,
  bom_id: zUuid,
  status: AgentRunStatusSchema,
  concurrency_preset: ConcurrencyPresetSchema,
  fanout_width: z.number().int(),
  depth_per_item: z.number().int(),
  /** Per-site hard cap — ALWAYS beats the user knob (FEATURES §15). */
  per_site_cap: z.number().int(),
  /** ₹ estimates/actuals — feed the AI spend meter [R2-37]. */
  est_cost: z.number().nullable(),
  actual_cost: z.number().nullable(),
  plan: z.unknown().nullable(),
  /** Version of `smark_learned_rules_doc` injected into the Opus plan. */
  rules_doc_version: z.number().int().nullable(),
  started_by: zUuid.nullable(),
});
export type AgentRunRow = z.infer<typeof AgentRunRowSchema>;

/** `smark_agent_results` — one row per (run, bom_line, distributor option); streamed. */
export const AgentResultRowSchema = z.object({
  ...baseRow,
  run_id: zUuid,
  bom_line_id: zUuid,
  part_id: zUuid.nullable(),
  distributor_id: zUuid,
  price: z.number().nullable(),
  qty_breaks: z.array(QtyBreakSchema).nullable(),
  stock_qty: z.number().int().nullable(),
  mpn_match: MpnMatchSchema,
  package_match: z.boolean(),
  /** Distributor-reported lifecycle status. */
  part_status: PartStatusSchema.nullable(),
  order_link: z.string().nullable(),
  is_recommended: z.boolean(),
  raw: z.unknown().nullable(),
  /** 0–100 agent confidence. */
  confidence: z.number().nullable(),
  /** [R2-08] the review's chosen option persists with the run. */
  selected: z.boolean(),
  selected_by: zUuid.nullable(),
  selected_at: zTimestamptz.nullable(),
});
export type AgentResultRow = z.infer<typeof AgentResultRowSchema>;

/** `smark_worker_heartbeats` — worker process metrics for /ai_orc (0008). */
export const WorkerHeartbeatRowSchema = z.object({
  ...baseRow,
  /** "hostname#pid" — upsert key; a restart replaces its own row. */
  worker_id: z.string(),
  hostname: z.string().nullable(),
  pid: z.number().int().nullable(),
  started_at: zTimestamptz.nullable(),
  last_seen_at: zTimestamptz,
  /** rssMb/heapUsedMb/sysFreeMb/sysTotalMb/cpuPercent/uptimeSec/activeItemAgents/runsInFlight/mode/…, see worker/src/telemetry.ts. */
  metrics: z.record(z.string(), z.unknown()),
});
export type WorkerHeartbeatRow = z.infer<typeof WorkerHeartbeatRowSchema>;

/** `smark_cart_items` [R2-09] — the smart cart, stage before an order. */
export const CartItemRowSchema = z.object({
  ...baseRow,
  /** Nullable for never-catalogued parts — then `descriptor` carries mpn/value/pkg. */
  part_id: zUuid.nullable(),
  descriptor: CartDescriptorSchema.nullable(),
  source: CartItemSourceSchema,
  /** Per-project breakdown — one cart line per part, aggregated across projects. */
  demand: z.array(CartDemandSliceSchema),
  /** Editable; prefill = shortfall or review qty. */
  qty_to_order: z.number().int(),
  /** → smark_agent_results (distributor + link), changeable. */
  chosen_result_id: zUuid.nullable(),
  /** Typed at cart stage; receipt extraction can overwrite [R2-12]. */
  unit_price: z.number().nullable(),
  status: CartItemStatusSchema,
  created_by: zUuid.nullable(),
});
export type CartItemRow = z.infer<typeof CartItemRowSchema>;

/** `smark_orders` [R2-12 · Q-06] — one row per distributor group at checkout;
 * global across projects (traceability lives on lines). */
export const OrderRowSchema = z.object({
  ...baseRow,
  distributor_id: zUuid,
  /** The website's order number — required, UNIQUE (matches deliveries). */
  po_number: z.string(),
  status: OrderStatusSchema,
  placed_by: zUuid.nullable(),
  placed_at: zTimestamptz,
  notes: z.string().nullable(),
  /** R2 file. */
  receipt_url: z.string().nullable(),
  /** AI-parsed receipt, user-confirmed before any write-back [R2-12]. */
  receipt_extracted: z.unknown().nullable(),
});
export type OrderRow = z.infer<typeof OrderRowSchema>;

/** `smark_order_lines`. */
export const OrderLineRowSchema = z.object({
  ...baseRow,
  order_id: zUuid,
  cart_item_id: zUuid.nullable(),
  /** Nullable — traceability to the BOM line where known. */
  bom_line_id: zUuid.nullable(),
  /** [R2-12] denorm for grouping; null for project-less manual buys. */
  project_id: zUuid.nullable(),
  part_id: zUuid.nullable(),
  chosen_distributor_id: zUuid.nullable(),
  chosen_result_id: zUuid.nullable(),
  qty_ordered: z.number().int(),
  unit_price: z.number().nullable(),
  line_status: OrderLineStatusSchema,
  arrived_qty: z.number().int(),
  arrived_at: zTimestamptz.nullable(),
});
export type OrderLineRow = z.infer<typeof OrderLineRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §5 Learning loop
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_agent_feedback` — whole-order remarks have `result_id` null, `run_id` set. */
export const AgentFeedbackRowSchema = z.object({
  ...baseRow,
  run_id: zUuid,
  result_id: zUuid.nullable(),
  comment: z.string(),
  feedback_tag: FeedbackTagSchema.nullable(),
  created_by: zUuid.nullable(),
  converted_rule_id: zUuid.nullable(),
});
export type AgentFeedbackRow = z.infer<typeof AgentFeedbackRowSchema>;

/** `smark_learned_rules`. */
export const LearnedRuleRowSchema = z.object({
  ...baseRow,
  scope: LearnedRuleScopeSchema,
  /** e.g. MPN, category name, project id — null for `global` scope. */
  subject: z.string().nullable(),
  rule_type: LearnedRuleTypeSchema,
  value: z.unknown(),
  confidence: z.number().nullable(),
  source_feedback_id: zUuid.nullable(),
  status: LearnedRuleStatusSchema,
  superseded_by: zUuid.nullable(),
  created_by: zUuid.nullable(),
});
export type LearnedRuleRow = z.infer<typeof LearnedRuleRowSchema>;

/** `smark_learned_rules_doc` — versioned digest injected into the Opus prompt
 * (aliased first, §12). `version` renders as `v{N}`. */
export const LearnedRulesDocRowSchema = z.object({
  ...baseRow,
  version: z.number().int(),
  content: z.string(),
  change_summary: z.string().nullable(),
  created_by: zUuid.nullable(),
});
export type LearnedRulesDocRow = z.infer<typeof LearnedRulesDocRowSchema>;

/** `smark_distributor_preferences` — global default the per-BOM sequence starts from. */
export const DistributorPreferenceRowSchema = z.object({
  ...baseRow,
  distributor_id: zUuid,
  rank: z.number().int(),
  enabled: z.boolean(),
});
export type DistributorPreferenceRow = z.infer<typeof DistributorPreferenceRowSchema>;

/** `smark_ordering_rules` — the standard search ladder; `package` row is
 * `mandatory` and non-disableable (A3 invariant). */
export const OrderingRuleRowSchema = z.object({
  ...baseRow,
  key: OrderingRuleKeySchema,
  enabled: z.boolean(),
  mandatory: z.boolean(),
  params: z.unknown().nullable(),
  rank: z.number().int(),
  created_by: zUuid.nullable(),
});
export type OrderingRuleRow = z.infer<typeof OrderingRuleRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §6 History, movements, labels
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_part_events` — append-only living record [R2-13]. */
export const PartEventRowSchema = z.object({
  ...baseRow,
  part_id: zUuid,
  event_type: PartEventTypeSchema,
  /** Distributor NAME as text (render label), not an FK. */
  distributor: z.string().nullable(),
  order_link: z.string().nullable(),
  /** Client attribution = render-time join project → client (no denorm copy). */
  project_id: zUuid.nullable(),
  reason: z.string().nullable(),
  qty: z.number().int().nullable(),
  unit_price: z.number().nullable(),
  location_big_box_id: zUuid.nullable(),
  actor: zUuid.nullable(),
  source_run_id: zUuid.nullable(),
  occurred_at: zTimestamptz,
  /** [R2-13] populated on `price_change` rows (old → new). */
  price_old: z.number().nullable(),
  price_new: z.number().nullable(),
  /** [R2-13] → smark_orders — PO chip. */
  order_id: zUuid.nullable(),
});
export type PartEventRow = z.infer<typeof PartEventRowSchema>;

/** `smark_movements` — every stock mutation; undoable via `undo_of` (A3). */
export const MovementRowSchema = z.object({
  ...baseRow,
  part_id: zUuid,
  /** Nullable — a movement can lack a box context (e.g. import-time adjust). */
  big_box_id: zUuid.nullable(),
  /** Signed. */
  delta_qty: z.number().int(),
  reason: MovementReasonSchema,
  /** [FEATURES.md §5.4/§9] 'audit' tags a guided box-audit variance (reason is
   * then 'adjust'); null for every other movement. */
  reason_detail: MovementReasonDetailSchema.nullable(),
  bom_id: zUuid.nullable(),
  /** NOT NULL in SQL — every movement stamps its real actor (§2). */
  actor: zUuid,
  /** Points at the movement this one reverses. */
  undo_of: zUuid.nullable(),
});
export type MovementRow = z.infer<typeof MovementRowSchema>;

/** `smark_qr_labels` — print rule: existing part top-up NEVER reprints;
 * new part exactly one label. All creation queues [R2-35]. */
export const QrLabelRowSchema = z.object({
  ...baseRow,
  target_type: QrTargetTypeSchema,
  target_id: zUuid,
  /** PID (`SMK-000482`) or big-box id. */
  code_value: z.string(),
  human_text: z.string().nullable(),
  png_url: z.string().nullable(),
  label_pdf_url: z.string().nullable(),
  printed_at: zTimestamptz.nullable(),
  /** Batch = one Avery-layout PDF. */
  batch_id: zUuid.nullable(),
  print_status: PrintStatusSchema,
  created_by: zUuid.nullable(),
});
export type QrLabelRow = z.infer<typeof QrLabelRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §7 Team, project management, finance, misc
 * ──────────────────────────────────────────────────────────────────────────── */

/** `smark_attendance` [R2-02] — one logical row per user per day. */
export const AttendanceRowSchema = z.object({
  ...baseRow,
  user_id: zUuid,
  work_date: zDateOnly,
  check_in: zTimestamptz.nullable(),
  check_out: zTimestamptz.nullable(),
  /** "What they're working on", switchable during the day. */
  current_project_id: zUuid.nullable(),
  note: z.string().nullable(),
});
export type AttendanceRow = z.infer<typeof AttendanceRowSchema>;

/**
 * (0009) `smark_holidays` — company-wide; either a `specific` date
 * (`holiday_date` set, `weekday` null) or a `weekly_off` weekday (`weekday`
 * 0-6, `holiday_date` null). Read by `lib/attendance/status.ts` to resolve
 * Holiday vs Absent for days with no attendance row.
 */
export const HolidayRowSchema = z.object({
  ...baseRow,
  kind: HolidayKindSchema,
  holiday_date: zDateOnly.nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  name: z.string(),
  created_by: zUuid.nullable(),
});
export type HolidayRow = z.infer<typeof HolidayRowSchema>;

/** (0009) `smark_leave_requests` — employee-submitted, owner-decided. */
export const LeaveRequestRowSchema = z.object({
  ...baseRow,
  user_id: zUuid,
  start_date: zDateOnly,
  end_date: zDateOnly,
  reason: LeaveReasonSchema,
  note: z.string().nullable(),
  status: ApprovalStatusSchema,
  decided_by: zUuid.nullable(),
  decided_at: zTimestamptz.nullable(),
});
export type LeaveRequestRow = z.infer<typeof LeaveRequestRowSchema>;

/**
 * (0009) `smark_comp_work` — employee's "I worked this holiday" claim,
 * owner-decided. Approved rows are the credit side of the derived comp
 * balance (`lib/attendance/queries.ts` `getCompBalance`).
 */
export const CompWorkRowSchema = z.object({
  ...baseRow,
  user_id: zUuid,
  work_date: zDateOnly,
  note: z.string().nullable(),
  status: ApprovalStatusSchema,
  decided_by: zUuid.nullable(),
  decided_at: zTimestamptz.nullable(),
});
export type CompWorkRow = z.infer<typeof CompWorkRowSchema>;

/** `smark_project_members` [R2-04] — `UNIQUE(project_id, user_id)`. */
export const ProjectMemberRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  user_id: zUuid,
  assigned_by: zUuid.nullable(),
  active: z.boolean(),
});
export type ProjectMemberRow = z.infer<typeof ProjectMemberRowSchema>;

/** `smark_time_entries` [R2-04 · Q-03 FINAL] — manual entry only. */
export const TimeEntryRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  user_id: zUuid,
  work_date: zDateOnly,
  /** numeric(4,1). */
  hours: z.number(),
  note: z.string().nullable(),
  /** NOT NULL in SQL — self, or the owner adding/correcting anyone's. */
  entered_by: zUuid,
});
export type TimeEntryRow = z.infer<typeof TimeEntryRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * (0010) Project management — tasks, assignees, time logs, bugs, change
 * requests, holds. See supabase/migrations/0010_pm.sql header.
 * ──────────────────────────────────────────────────────────────────────────── */

/** (0010) `smark_tasks`. */
export const TaskRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  source: TaskSourceSchema,
  origin_change_request_id: zUuid.nullable(),
  submitted_at: zTimestamptz.nullable(),
  done_at: zTimestamptz.nullable(),
  created_by: zUuid.nullable(),
});
export type TaskRow = z.infer<typeof TaskRowSchema>;

/** (0010) `smark_task_assignees` — per-engineer estimated hours live here. */
export const TaskAssigneeRowSchema = z.object({
  ...baseRow,
  task_id: zUuid,
  user_id: zUuid,
  /** numeric(6,1). */
  estimated_hours: z.number(),
  assigned_by: zUuid.nullable(),
});
export type TaskAssigneeRow = z.infer<typeof TaskAssigneeRowSchema>;

/** (0010) `smark_time_logs` — description is MANDATORY. Distinct from legacy `smark_time_entries`. */
export const TimeLogRowSchema = z.object({
  ...baseRow,
  task_id: zUuid,
  user_id: zUuid,
  work_date: zDateOnly,
  /** numeric(5,1). */
  hours: z.number(),
  description: z.string(),
  created_by: zUuid.nullable(),
});
export type TimeLogRow = z.infer<typeof TimeLogRowSchema>;

/** (0010) `smark_bugs` — only status=confirmed AND classification=bug counts toward effectiveness. */
export const BugRowSchema = z.object({
  ...baseRow,
  task_id: zUuid,
  description: z.string(),
  classification: BugClassificationSchema,
  status: BugStatusSchema,
  reported_source: ReportedSourceSchema,
  /** Null when reported via the client portal (no smark_app_users identity). */
  reported_by: zUuid.nullable(),
  decided_by: zUuid.nullable(),
});
export type BugRow = z.infer<typeof BugRowSchema>;

/** (0010) `smark_change_requests` — accepting one spawns a smark_tasks row. */
export const ChangeRequestRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  description: z.string(),
  status: ChangeRequestStatusSchema,
  requested_source: RequestedSourceSchema,
  resulting_task_id: zUuid.nullable(),
  decided_by: zUuid.nullable(),
});
export type ChangeRequestRow = z.infer<typeof ChangeRequestRowSchema>;

/** (0010) `smark_task_holds` — an open row (`ended_at` null) = task awaiting client input. */
export const TaskHoldRowSchema = z.object({
  ...baseRow,
  task_id: zUuid,
  reason: z.string(),
  started_at: zTimestamptz,
  ended_at: zTimestamptz.nullable(),
  started_by: zUuid.nullable(),
  ended_source: HoldEndedSourceSchema.nullable(),
  ended_by: zUuid.nullable(),
});
export type TaskHoldRow = z.infer<typeof TaskHoldRowSchema>;

/**
 * (0012) `smark_task_reminders` — recurring "client input still needed" email
 * for a task with an open `smark_task_holds` row. One active row per task
 * (app-level upsert in lib/reminders/actions.ts, not a DB constraint).
 */
export const TaskReminderRowSchema = z.object({
  ...baseRow,
  task_id: zUuid,
  subject: z.string(),
  body: z.string(),
  frequency_days: z.number().int().positive(),
  last_sent_at: zTimestamptz.nullable(),
  next_send_at: zTimestamptz,
  active: z.boolean(),
  created_by: zUuid.nullable(),
});
export type TaskReminderRow = z.infer<typeof TaskReminderRowSchema>;

/** `smark_project_activities` [R2-06] — append-only feed (15-min author edit
 * window enforced in app). */
export const ProjectActivityRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  type: ActivityTypeSchema,
  title: z.string().nullable(),
  body: z.string().nullable(),
  /** Task fields — null unless `type = 'task'`. */
  task_assignee: zUuid.nullable(),
  task_due: zDateOnly.nullable(),
  task_done: z.boolean().nullable(),
  task_done_at: zTimestamptz.nullable(),
  /** Null for portal-originated comments (see `from_portal`). */
  created_by: zUuid.nullable(),
  /** FEATURES §13 — opt-in portal sharing, default OFF. */
  shared_to_portal: z.boolean(),
  /** FEATURES §17 — comment arrived via the client portal. */
  from_portal: z.boolean(),
});
export type ProjectActivityRow = z.infer<typeof ProjectActivityRowSchema>;

/** `smark_project_documents` [R2-16] — named uploads to R2; soft-deleted rows kept. */
export const ProjectDocumentRowSchema = z.object({
  ...baseRow,
  project_id: zUuid,
  display_name: z.string(),
  file_url: z.string(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().nullable(),
  note: z.string().nullable(),
  uploaded_by: zUuid.nullable(),
  deleted_at: zTimestamptz.nullable(),
  /** FEATURES §17 — opt-in portal sharing, default OFF. */
  shared_to_portal: z.boolean(),
});
export type ProjectDocumentRow = z.infer<typeof ProjectDocumentRowSchema>;

/** `smark_ai_aliases` [R2-17] — server-side pseudonym map, never sent to clients.
 * MPN / LCSC PN / package / distributor names pass through REAL (§12). */
export const AiAliasRowSchema = z.object({
  ...baseRow,
  entity_type: AliasEntityTypeSchema,
  entity_id: zUuid,
  /** e.g. `CLIENT-A`, `PROJ-03`; UNIQUE. */
  alias: z.string(),
});
export type AiAliasRow = z.infer<typeof AiAliasRowSchema>;

/** `smark_expenses` [R2-20 · Q-09 FINAL] — owner or accountant writes. */
export const ExpenseRowSchema = z.object({
  ...baseRow,
  entry_type: ExpenseEntryTypeSchema,
  /** numeric(14,2). */
  amount: z.number(),
  currency: z.string(),
  entry_date: zDateOnly,
  category: ExpenseCategorySchema,
  /** Nullable: a PO-auto-created draft defers the account until owner-confirm
   * (seed.sql seeds no expense accounts); a confirmed (is_draft=false) row must
   * carry one — DB CHECK smark_expenses_account_when_confirmed. */
  account_id: zUuid.nullable(),
  /** Party/distributor. */
  vendor: z.string().nullable(),
  gstin: z.string().nullable(),
  tax_amount: z.number().nullable(),
  /** Set = this IS a project payment. */
  project_id: zUuid.nullable(),
  note: z.string().nullable(),
  attachment_url: z.string().nullable(),
  /** PO-auto-created entries start true until owner confirms. */
  is_draft: z.boolean(),
  /** The PO that spawned it. */
  source_order_id: zUuid.nullable(),
  created_by: zUuid.nullable(),
  /** Soft delete for audit. */
  deleted_at: zTimestamptz.nullable(),
});
export type ExpenseRow = z.infer<typeof ExpenseRowSchema>;

/** `smark_expense_accounts` [R2-28] — owner-only CRUD (Settings). */
export const ExpenseAccountRowSchema = z.object({
  ...baseRow,
  /** "HDFC current", "Cash box", "Owner UPI". */
  name: z.string(),
  account_type: ExpenseAccountTypeSchema,
  active: z.boolean(),
  created_by: zUuid.nullable(),
});
export type ExpenseAccountRow = z.infer<typeof ExpenseAccountRowSchema>;

/** `smark_part_field_templates` [R2-23] — remembered custom part-form fields;
 * values live in `smark_parts.attributes`. */
export const PartFieldTemplateRowSchema = z.object({
  ...baseRow,
  label: z.string(),
  /** Slug key into `attributes`. */
  field_key: z.string(),
  field_type: FieldTypeSchema,
  active: z.boolean(),
  created_by: zUuid.nullable(),
});
export type PartFieldTemplateRow = z.infer<typeof PartFieldTemplateRowSchema>;

/** `smark_notifications` [R2-36] — fan-out per role matrix; bell badge = unread. */
export const NotificationRowSchema = z.object({
  ...baseRow,
  /** Recipient. */
  user_id: zUuid,
  kind: NotificationKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  /** Deep link. */
  link: z.string().nullable(),
  read_at: zTimestamptz.nullable(),
});
export type NotificationRow = z.infer<typeof NotificationRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §8 Derived views [R2-07 / R2-10 / R2-21]
 * View row CONTRACTS — the SQL lives with the DB package; if a view's column
 * list changes there, update these in lockstep.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Source discriminator for `v_daily_activity` rows. */
export const DailyActivityKindSchema = z.enum([
  "movement",
  "part_event",
  "run_started",
  "run_finished",
  "cart_add",
  "order_placed",
  "arrival",
  "attendance",
  "time_entry",
]);
export type DailyActivityKind = z.infer<typeof DailyActivityKindSchema>;

/** `v_daily_activity` [R2-07] — read-only union powering Daily Reports. */
export const DailyActivityRowSchema = z.object({
  work_date: zDateOnly,
  occurred_at: zTimestamptz,
  actor: zUuid.nullable(),
  kind: DailyActivityKindSchema,
  /** id of the underlying row (movement/event/run/cart/order/attendance/entry). */
  ref_id: zUuid,
  part_id: zUuid.nullable(),
  project_id: zUuid.nullable(),
  order_id: zUuid.nullable(),
  run_id: zUuid.nullable(),
  qty: z.number().nullable(),
  summary: z.string().nullable(),
});
export type DailyActivityRow = z.infer<typeof DailyActivityRowSchema>;

/** `v_part_demand` [R2-10 · Q-05 FINAL] — demand = Σ(line qty × build_qty) over
 * matched lines in active, reconciled BOMs of non-archived projects.
 * Permanent fixture: 500 avail, A needs 400 + B needs 200 → shortfall 100. */
export const PartDemandRowSchema = z.object({
  part_id: zUuid,
  demand: z.number().int(),
  /** = `smark_parts.total_qty`. */
  available: z.number().int(),
  /** GREATEST(demand − available, 0). */
  shortfall: z.number().int(),
  /** Per-project breakdown — same slice shape as `smark_cart_items.demand`. */
  breakdown: z.array(CartDemandSliceSchema),
});
export type PartDemandRow = z.infer<typeof PartDemandRowSchema>;

/** Rollup bucket for `v_expense_rollups`. */
export const RollupBucketSchema = z.enum(["month", "quarter", "year"]);
export type RollupBucket = z.infer<typeof RollupBucketSchema>;

/** `v_expense_rollups` [R2-21] — sums by type/category/account/project per bucket. */
export const ExpenseRollupRowSchema = z.object({
  bucket: RollupBucketSchema,
  /** `2026-07` / `2026-Q3` / `2026`. */
  period: z.string(),
  entry_type: ExpenseEntryTypeSchema,
  category: z.string().nullable(),
  account_id: zUuid.nullable(),
  project_id: zUuid.nullable(),
  total: z.number(),
  entry_count: z.number().int(),
});
export type ExpenseRollupRow = z.infer<typeof ExpenseRollupRowSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Table name map + Supabase `Database` generic
 * ──────────────────────────────────────────────────────────────────────────── */

/** Canonical table/view names — use these instead of string literals. */
export const TABLES = {
  app_users: "smark_app_users",
  parts: "smark_parts",
  distributors: "smark_distributors",
  projects: "smark_projects",
  project_phases: "smark_project_phases",
  shelves: "smark_shelves",
  big_boxes: "smark_big_boxes",
  stock_locations: "smark_stock_locations",
  boms: "smark_boms",
  bom_templates: "smark_bom_templates",
  bom_lines: "smark_bom_lines",
  order_jobs: "smark_order_jobs",
  agent_runs: "smark_agent_runs",
  agent_results: "smark_agent_results",
  cart_items: "smark_cart_items",
  orders: "smark_orders",
  order_lines: "smark_order_lines",
  agent_feedback: "smark_agent_feedback",
  learned_rules: "smark_learned_rules",
  learned_rules_doc: "smark_learned_rules_doc",
  distributor_preferences: "smark_distributor_preferences",
  ordering_rules: "smark_ordering_rules",
  part_events: "smark_part_events",
  movements: "smark_movements",
  qr_labels: "smark_qr_labels",
  attendance: "smark_attendance",
  holidays: "smark_holidays",
  leave_requests: "smark_leave_requests",
  comp_work: "smark_comp_work",
  project_members: "smark_project_members",
  time_entries: "smark_time_entries",
  tasks: "smark_tasks",
  task_assignees: "smark_task_assignees",
  time_logs: "smark_time_logs",
  bugs: "smark_bugs",
  change_requests: "smark_change_requests",
  task_holds: "smark_task_holds",
  task_reminders: "smark_task_reminders",
  project_activities: "smark_project_activities",
  project_documents: "smark_project_documents",
  ai_aliases: "smark_ai_aliases",
  expenses: "smark_expenses",
  expense_accounts: "smark_expense_accounts",
  part_field_templates: "smark_part_field_templates",
  notifications: "smark_notifications",
  worker_heartbeats: "smark_worker_heartbeats",
  employee_private: "smark_employee_private",
  employee_documents: "smark_employee_documents",
  module_grants: "smark_user_module_grants",
} as const;

export const VIEWS = {
  daily_activity: "v_daily_activity",
  part_demand: "v_part_demand",
  expense_rollups: "v_expense_rollups",
} as const;

/**
 * Table shape for the Supabase generic. `Insert`/`Update` are intentionally
 * `Partial<Row>`: the DB owns defaults/required-ness, and every server action
 * must validate its payload with the zod row schemas above (or a `.pick()` of
 * them) before writing — the client generic is not the validation layer.
 */
type TableOf<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type ViewOf<Row extends Record<string, unknown>> = {
  Row: Row;
  Relationships: [];
};

/** Supabase `Database` generic — pass to `createBrowserClient<Database>` etc. */
export type Database = {
  public: {
    Tables: {
      smark_app_users: TableOf<AppUserRow>;
      smark_parts: TableOf<PartRow>;
      smark_distributors: TableOf<DistributorRow>;
      smark_projects: TableOf<ProjectRow>;
      smark_project_phases: TableOf<ProjectPhaseRow>;
      smark_shelves: TableOf<ShelfRow>;
      smark_big_boxes: TableOf<BigBoxRow>;
      smark_stock_locations: TableOf<StockLocationRow>;
      smark_boms: TableOf<BomRow>;
      smark_bom_templates: TableOf<BomTemplateRow>;
      smark_bom_lines: TableOf<BomLineRow>;
      smark_order_jobs: TableOf<OrderJobRow>;
      smark_agent_runs: TableOf<AgentRunRow>;
      smark_agent_results: TableOf<AgentResultRow>;
      smark_cart_items: TableOf<CartItemRow>;
      smark_orders: TableOf<OrderRow>;
      smark_order_lines: TableOf<OrderLineRow>;
      smark_agent_feedback: TableOf<AgentFeedbackRow>;
      smark_learned_rules: TableOf<LearnedRuleRow>;
      smark_learned_rules_doc: TableOf<LearnedRulesDocRow>;
      smark_distributor_preferences: TableOf<DistributorPreferenceRow>;
      smark_ordering_rules: TableOf<OrderingRuleRow>;
      smark_part_events: TableOf<PartEventRow>;
      smark_movements: TableOf<MovementRow>;
      smark_qr_labels: TableOf<QrLabelRow>;
      smark_attendance: TableOf<AttendanceRow>;
      smark_holidays: TableOf<HolidayRow>;
      smark_leave_requests: TableOf<LeaveRequestRow>;
      smark_comp_work: TableOf<CompWorkRow>;
      smark_project_members: TableOf<ProjectMemberRow>;
      smark_time_entries: TableOf<TimeEntryRow>;
      smark_tasks: TableOf<TaskRow>;
      smark_task_assignees: TableOf<TaskAssigneeRow>;
      smark_time_logs: TableOf<TimeLogRow>;
      smark_bugs: TableOf<BugRow>;
      smark_change_requests: TableOf<ChangeRequestRow>;
      smark_task_holds: TableOf<TaskHoldRow>;
      smark_task_reminders: TableOf<TaskReminderRow>;
      smark_project_activities: TableOf<ProjectActivityRow>;
      smark_project_documents: TableOf<ProjectDocumentRow>;
      smark_ai_aliases: TableOf<AiAliasRow>;
      smark_expenses: TableOf<ExpenseRow>;
      smark_expense_accounts: TableOf<ExpenseAccountRow>;
      smark_part_field_templates: TableOf<PartFieldTemplateRow>;
      smark_notifications: TableOf<NotificationRow>;
      smark_worker_heartbeats: TableOf<WorkerHeartbeatRow>;
      smark_employee_private: TableOf<EmployeePrivateRow>;
      smark_employee_documents: TableOf<EmployeeDocumentRow>;
      smark_user_module_grants: TableOf<ModuleGrantRow>;
    };
    Views: {
      v_daily_activity: ViewOf<DailyActivityRow>;
      v_part_demand: ViewOf<PartDemandRow>;
      v_expense_rollups: ViewOf<ExpenseRollupRow>;
    };
    Functions: {
      /**
       * SQL helper reading the caller's role for RLS policies (SCHEMA §0).
       * `select role from smark_app_users where id = auth.uid() and active`
       * returns NO row — i.e. SQL NULL — for anon, unknown, or DEACTIVATED
       * callers, so the value is `AppRole | null`. Callers MUST null-check
       * before use: a null role must grant NOTHING (see lib/auth/roles.ts
       * accessFor, which maps null → "hidden").
       */
      smark_role: {
        Args: Record<PropertyKey, never>;
        Returns: AppRole | null;
      };
      /**
       * Atomic worker job-claim (migration 0007). `UPDATE ... WHERE id IN
       * (SELECT ... FOR UPDATE SKIP LOCKED LIMIT p_limit) RETURNING *` — the
       * single-statement claim path PostgREST can't express directly, so the
       * worker calls it via `.rpc()`. SECURITY DEFINER, service_role-only.
       * Returns the rows it claimed (0..p_limit) as full `smark_order_jobs`.
       */
      smark_claim_next_order_jobs: {
        Args: { p_limit?: number };
        Returns: OrderJobRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** Convenience lookups. */
export type TableName = keyof Database["public"]["Tables"];
export type ViewName = keyof Database["public"]["Views"];
export type RowOf<T extends TableName> = Database["public"]["Tables"][T]["Row"];
